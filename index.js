// import { InferenceClient } from "@huggingface/inference";
// import dotenv from 'dotenv';
// import fs from 'fs';

// dotenv.config();

// const client = new InferenceClient(process.env.HUGGINGFACE_API_KEY);

// console.log("Generating image..."); // Add progress feedback

// const image = await client.textToImage({
//     provider: "together",
//     model: "black-forest-labs/FLUX.1-dev",
//     inputs: "Astronaut riding a horse",
//     parameters: { num_inference_steps: 5 },
// });

// // Convert the Blob to a Buffer and save it
// const buffer = Buffer.from(await image.arrayBuffer());
// fs.writeFileSync('astronaut.png', buffer);

// console.log("Image saved as astronaut.png!"); // Confirmation message

import express from 'express';
import { InferenceClient } from "@huggingface/inference";
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public')); // Serve static files (images)

// Create public directory if it doesn't exist
if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
}

const client = new InferenceClient(process.env.HUGGINGFACE_API_KEY);

// POST endpoint to generate image
app.post('/generate-image', async (req, res) => {
    try {
        const { prompt, steps = 5 } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        console.log(`Generating image for prompt: "${prompt}"`);

        const image = await client.textToImage({
            provider: "together",
            model: "black-forest-labs/FLUX.1-dev",
            inputs: prompt,
            parameters: { num_inference_steps: steps },
        });

        // Convert the Blob to a Buffer and save it
        const buffer = Buffer.from(await image.arrayBuffer());
        const filename = `image-${Date.now()}.png`;
        const filepath = path.join('public', filename);
        
        fs.writeFileSync(filepath, buffer);

        console.log(`Image saved as ${filename}`);

        res.json({
            success: true,
            message: 'Image generated successfully',
            imageUrl: `/${filename}`,
            filename: filename
        });

    } catch (error) {
        console.error('Error generating image:', error);
        res.status(500).json({
            error: 'Failed to generate image',
            details: error.message
        });
    }
});

// GET endpoint to test
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Image Generator</title>
            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                input, button { padding: 10px; margin: 10px 0; }
                input { width: 100%; box-sizing: border-box; }
                button { background: #007bff; color: white; border: none; cursor: pointer; }
                button:hover { background: #0056b3; }
                #result { margin-top: 20px; }
                img { max-width: 100%; border: 1px solid #ddd; margin-top: 10px; }
            </style>
        </head>
        <body>
            <h1>Image Generator</h1>
            <input type="text" id="prompt" placeholder="Enter your prompt (e.g., Astronaut riding a horse)" />
            <button onclick="generateImage()">Generate Image</button>
            <div id="result"></div>

            <script>
                async function generateImage() {
                    const prompt = document.getElementById('prompt').value;
                    const resultDiv = document.getElementById('result');
                    
                    if (!prompt) {
                        alert('Please enter a prompt');
                        return;
                    }

                    resultDiv.innerHTML = 'Generating image...';

                    try {
                        const response = await fetch('/generate-image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ prompt, steps: 5 })
                        });

                        const data = await response.json();

                        if (data.success) {
                            resultDiv.innerHTML = \`
                                <p>Image generated successfully!</p>
                                <img src="\${data.imageUrl}" alt="Generated image" />
                            \`;
                        } else {
                            resultDiv.innerHTML = \`<p style="color: red;">Error: \${data.error}</p>\`;
                        }
                    } catch (error) {
                        resultDiv.innerHTML = \`<p style="color: red;">Error: \${error.message}</p>\`;
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});