import { InferenceClient } from "@huggingface/inference";
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const client = new InferenceClient(process.env.HUGGINGFACE_API_KEY);

console.log("Generating image..."); // Add progress feedback

const image = await client.textToImage({
    provider: "together",
    model: "black-forest-labs/FLUX.1-dev",
    inputs: "Astronaut riding a horse",
    parameters: { num_inference_steps: 5 },
});

// Convert the Blob to a Buffer and save it
const buffer = Buffer.from(await image.arrayBuffer());
fs.writeFileSync('astronaut.png', buffer);

console.log("Image saved as astronaut.png!"); // Confirmation message