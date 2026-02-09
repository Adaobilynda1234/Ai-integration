import express from 'express';
import { InferenceClient } from '@huggingface/inference';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Initialize HuggingFace client
const client = new InferenceClient(process.env.HUGGINGFACE_API_KEY);

// In-memory conversation store (use Redis/DB in production)
const conversations = new Map();

// Available models (all free on HF Inference API)
const MODELS = {
    'llama3': 'meta-llama/Llama-3.1-8B-Instruct',
    'mistral': 'mistralai/Mistral-7B-Instruct-v0.3',
    'phi3': 'microsoft/Phi-3-mini-4k-instruct',
    'qwen': 'Qwen/Qwen2.5-7B-Instruct',
    'gemma': 'google/gemma-2-9b-it',
};

const DEFAULT_MODEL = 'llama3';

// ─── Helper: resolve model name ───
function resolveModel(model) {
    if (!model) return MODELS[DEFAULT_MODEL];
    // If it's a shorthand key, resolve it
    if (MODELS[model]) return MODELS[model];
    // Otherwise assume it's a full model ID
    return model;
}

// ─── Helper: get or create conversation ───
function getConversation(conversationId) {
    if (conversationId && conversations.has(conversationId)) {
        return { id: conversationId, ...conversations.get(conversationId) };
    }
    const id = conversationId || randomUUID();
    const convo = {
        messages: [],
        systemPrompt: 'You are a helpful, friendly AI assistant.',
        model: MODELS[DEFAULT_MODEL],
        createdAt: new Date().toISOString(),
    };
    conversations.set(id, convo);
    return { id, ...convo };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── GET /models — list available models ───
app.get('/models', (req, res) => {
    res.json({
        models: Object.entries(MODELS).map(([key, value]) => ({
            shorthand: key,
            modelId: value,
            isDefault: key === DEFAULT_MODEL,
        })),
    });
});

// ─── POST /chat — single message (no history) ───
app.post('/chat', async (req, res) => {
    try {
        const { message, model, systemPrompt, temperature = 0.7, max_tokens = 1024 } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        const resolvedModel = resolveModel(model);

        const messages = [
            { role: 'system', content: systemPrompt || 'You are a helpful, friendly AI assistant.' },
            { role: 'user', content: message },
        ];

        console.log(`[chat] model=${resolvedModel} message="${message.slice(0, 50)}..."`);

        const response = await client.chatCompletion({
            model: resolvedModel,
            messages,
            temperature,
            max_tokens,
        });

        const reply = response.choices[0]?.message?.content || '';

        res.json({
            success: true,
            reply,
            model: resolvedModel,
            usage: response.usage || null,
        });
    } catch (error) {
        console.error('[chat] Error:', error.message);
        res.status(500).json({ error: 'Failed to generate response', details: error.message });
    }
});

// ─── POST /chat/stream — single message with SSE streaming ───
app.post('/chat/stream', async (req, res) => {
    try {
        const { message, model, systemPrompt, temperature = 0.7, max_tokens = 1024 } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        const resolvedModel = resolveModel(model);

        const messages = [
            { role: 'system', content: systemPrompt || 'You are a helpful, friendly AI assistant.' },
            { role: 'user', content: message },
        ];

        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        console.log(`[stream] model=${resolvedModel} message="${message.slice(0, 50)}..."`);

        const stream = client.chatCompletionStream({
            model: resolvedModel,
            messages,
            temperature,
            max_tokens,
        });

        let fullResponse = '';

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullResponse += content;
                res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
            }
        }

        res.write(`data: ${JSON.stringify({ content: '', done: true, fullResponse })}\n\n`);
        res.end();
    } catch (error) {
        console.error('[stream] Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Streaming failed', details: error.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
            res.end();
        }
    }
});

// ─── POST /conversation — chat with persistent history ───
app.post('/conversation', async (req, res) => {
    try {
        const {
            message,
            conversationId,
            model,
            systemPrompt,
            temperature = 0.7,
            max_tokens = 1024,
        } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        // Get or create conversation
        const convo = getConversation(conversationId);
        const storedConvo = conversations.get(convo.id);

        // Update system prompt / model if provided
        if (systemPrompt) storedConvo.systemPrompt = systemPrompt;
        if (model) storedConvo.model = resolveModel(model);

        // Add user message to history
        storedConvo.messages.push({ role: 'user', content: message });

        // Build messages array with system prompt
        const messages = [
            { role: 'system', content: storedConvo.systemPrompt },
            ...storedConvo.messages,
        ];

        // Keep context window manageable (last 20 messages)
        if (storedConvo.messages.length > 20) {
            storedConvo.messages = storedConvo.messages.slice(-20);
        }

        console.log(`[convo:${convo.id.slice(0, 8)}] messages=${storedConvo.messages.length} model=${storedConvo.model}`);

        const response = await client.chatCompletion({
            model: storedConvo.model,
            messages,
            temperature,
            max_tokens,
        });

        const reply = response.choices[0]?.message?.content || '';

        // Add assistant reply to history
        storedConvo.messages.push({ role: 'assistant', content: reply });
        storedConvo.updatedAt = new Date().toISOString();

        res.json({
            success: true,
            conversationId: convo.id,
            reply,
            model: storedConvo.model,
            messageCount: storedConvo.messages.length,
            usage: response.usage || null,
        });
    } catch (error) {
        console.error('[conversation] Error:', error.message);
        res.status(500).json({ error: 'Failed to generate response', details: error.message });
    }
});

// ─── GET /conversation/:id — get conversation history ───
app.get('/conversation/:id', (req, res) => {
    const convo = conversations.get(req.params.id);
    if (!convo) {
        return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({
        conversationId: req.params.id,
        systemPrompt: convo.systemPrompt,
        model: convo.model,
        messageCount: convo.messages.length,
        messages: convo.messages,
        createdAt: convo.createdAt,
        updatedAt: convo.updatedAt,
    });
});

// ─── DELETE /conversation/:id — delete conversation ───
app.delete('/conversation/:id', (req, res) => {
    if (!conversations.has(req.params.id)) {
        return res.status(404).json({ error: 'Conversation not found' });
    }
    conversations.delete(req.params.id);
    res.json({ success: true, message: 'Conversation deleted' });
});

// ─── GET /conversations — list all conversations ───
app.get('/conversations', (req, res) => {
    const list = [];
    for (const [id, convo] of conversations) {
        list.push({
            conversationId: id,
            messageCount: convo.messages.length,
            model: convo.model,
            lastMessage: convo.messages[convo.messages.length - 1]?.content?.slice(0, 100) || '',
            createdAt: convo.createdAt,
            updatedAt: convo.updatedAt,
        });
    }
    res.json({ conversations: list });
});

// ─── Serve simple chat UI ───
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HF Chatbot</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
        header { padding: 16px 24px; background: #1a1a1a; border-bottom: 1px solid #2a2a2a; display: flex; justify-content: space-between; align-items: center; }
        header h1 { font-size: 18px; color: #fff; }
        select { background: #2a2a2a; color: #e0e0e0; border: 1px solid #3a3a3a; padding: 6px 10px; border-radius: 6px; }
        #chat { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
        .msg { max-width: 75%; padding: 12px 16px; border-radius: 12px; line-height: 1.5; white-space: pre-wrap; }
        .user { align-self: flex-end; background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
        .assistant { align-self: flex-start; background: #1e1e1e; border: 1px solid #2a2a2a; border-bottom-left-radius: 4px; }
        .typing { opacity: 0.5; font-style: italic; }
        #input-area { padding: 16px 24px; background: #1a1a1a; border-top: 1px solid #2a2a2a; display: flex; gap: 12px; }
        #input-area input { flex: 1; background: #2a2a2a; color: #fff; border: 1px solid #3a3a3a; padding: 12px 16px; border-radius: 8px; font-size: 14px; outline: none; }
        #input-area input:focus { border-color: #2563eb; }
        #input-area button { background: #2563eb; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; }
        #input-area button:hover { background: #1d4ed8; }
        #input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    </style>
</head>
<body>
    <header>
        <h1>HF Chatbot API</h1>
        <select id="model">
            <option value="llama3">Llama 3.1 8B</option>
            <option value="mistral">Mistral 7B</option>
            <option value="phi3">Phi-3 Mini</option>
            <option value="qwen">Qwen 2.5 7B</option>
            <option value="gemma">Gemma 2 9B</option>
        </select>
    </header>
    <div id="chat"></div>
    <div id="input-area">
        <input id="msg" type="text" placeholder="Type a message..." autofocus />
        <button id="send" onclick="send()">Send</button>
    </div>
    <script>
        let conversationId = null;
        const chat = document.getElementById('chat');
        const msgInput = document.getElementById('msg');
        const sendBtn = document.getElementById('send');

        msgInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !sendBtn.disabled) send(); });

        function addMessage(role, text) {
            const div = document.createElement('div');
            div.className = 'msg ' + role;
            div.textContent = text;
            chat.appendChild(div);
            chat.scrollTop = chat.scrollHeight;
            return div;
        }

        async function send() {
            const message = msgInput.value.trim();
            if (!message) return;

            msgInput.value = '';
            sendBtn.disabled = true;
            addMessage('user', message);

            const typing = addMessage('assistant', 'Thinking...');
            typing.classList.add('typing');

            try {
                const res = await fetch('/conversation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message,
                        conversationId,
                        model: document.getElementById('model').value,
                    }),
                });
                const data = await res.json();

                if (data.success) {
                    conversationId = data.conversationId;
                    typing.textContent = data.reply;
                    typing.classList.remove('typing');
                } else {
                    typing.textContent = 'Error: ' + (data.error || 'Unknown error');
                    typing.classList.remove('typing');
                }
            } catch (err) {
                typing.textContent = 'Error: ' + err.message;
                typing.classList.remove('typing');
            }

            sendBtn.disabled = false;
            msgInput.focus();
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Chatbot API running on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  GET  /              - Chat UI');
    console.log('  GET  /models        - List available models');
    console.log('  POST /chat          - Single message (no history)');
    console.log('  POST /chat/stream   - Single message with SSE streaming');
    console.log('  POST /conversation  - Chat with persistent history');
    console.log('  GET  /conversation/:id  - Get conversation history');
    console.log('  DELETE /conversation/:id - Delete conversation');
    console.log('  GET  /conversations     - List all conversations');
});