import OpenAI from "openai";
import express from 'express';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();

app.use(express.json());

const client = new OpenAI({
  baseURL: process.env.HUGGINGFACE_BASE_URL,
  apiKey: process.env.HUGGINGFACE_API_KEY,
});

const messages = [
  { role: "system", content: "You reply in short sentences." }
];


app.get('/', async (req, res) => {
  res.status(200).json({ message: "Welcome to Botworld" });
});

app.post('/ask', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(404).json({ message: "empty prompt" });
  }

  try {
    const response = await sendMessage(prompt);
    res.status(200).json({ message: response });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: "Error processing request" });
  }
});


const PORT = process.env.PORT || 2000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


async function sendMessage(text) {
  messages.push({ role: "user", content: text });

  const res = await client.chat.completions.create({
    model: "Qwen/Qwen2.5-7B-Instruct",
    messages,
    max_tokens: 150
  });

  const reply = res.choices[0].message.content;

  messages.push({ role: "assistant", content: reply });

  return reply;
}