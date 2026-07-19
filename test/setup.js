// Default model set used by unit tests (mirrors the web app's defaults).
globalThis.__MODELS_CONFIG__ = {
  chat: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  embedding: '@cf/baai/bge-base-en-v1.5',
  text_to_speech: '@cf/myshell-ai/melotts',
  speech_to_text: '@cf/openai/whisper-large-v3-turbo',
};
