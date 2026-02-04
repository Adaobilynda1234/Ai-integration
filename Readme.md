# Botworld API

A simple Express.js server that interfaces with HuggingFace's AI models.

## Setup

1. Install dependencies:
```bash
npm install express openai dotenv
```

2. Create a `.env` file in the root directory with your HuggingFace API key:
```
HUGGINGFACE_API_KEY=your_api_key_here
HUGGINGFACE_BASE_URL=https://router.huggingface.co/v1
PORT=2000
```

3. Run the server:
```bash
node index.js
```

## API Endpoints

### GET /
Health check endpoint
- **Response**: `{ "message": "Welcome to Botworld" }`

### POST /ask
Send a prompt to the AI
- **Body**: `{ "prompt": "your question here" }`
- **Response**: `{ "message": "AI response" }`

## Security Notes

- Never commit your `.env` file to git
- The `.gitignore` file is configured to exclude sensitive files
- Keep your API keys secure and rotate them regularly