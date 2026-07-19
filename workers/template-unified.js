/**
 * OpenAI-compatible Cloudflare Worker for Workers AI.
 *
 * The CONFIG object (one model id per type) is injected at deploy time by
 * replacing the __DEPLOY_INJECT_CONFIG__ placeholder (see deploy.js). In tests, the same
 * shape is provided via globalThis.__MODELS_CONFIG__ (see test/setup.js).
 *
 * Endpoints (only enabled if the matching model is present in CONFIG):
 *   GET  /v1/models                  always available
 *   POST /v1/chat/completions        requires CONFIG.chat
 *   POST /v1/embeddings              requires CONFIG.embedding
 *   POST /v1/audio/transcriptions    requires CONFIG.speech_to_text
 *   POST /v1/audio/speech            requires CONFIG.text_to_speech
 *   GET  /health                     always available
 */

const CONFIG = globalThis.__MODELS_CONFIG__ || "__DEPLOY_INJECT_CONFIG__";

const TYPE_TO_CF_MODEL = { ...CONFIG };
const CF_MODEL_TO_TYPE = Object.fromEntries(
    Object.entries(CONFIG).map(([type, id]) => [id, type])
);

/**
 * Resolve a request's "model" field to the Cloudflare model id.
 * Accepts either the type alias ("chat") or the full CF id.
 * Returns null if not found or wrong type for the endpoint.
 */
function resolveModel(requested, expectedType) {
    if (!requested) return null;
    if (TYPE_TO_CF_MODEL[requested] && requested === expectedType) {
        return TYPE_TO_CF_MODEL[requested];
    }
    if (CF_MODEL_TO_TYPE[requested] === expectedType) {
        return requested;
    }
    return null;
}

/**
 * Retry env.AI.run() on transient errors with exponential backoff.
 */
async function retryAIRun(env, cfModel, modelOptions, maxRetries = 3) {
    const BASE_DELAY_MS = 500;
    const MAX_DELAY_MS = 4000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await env.AI.run(cfModel, modelOptions);
        } catch (error) {
            const msg = (error.message || '').toLowerCase();
            const isTransient =
                msg.includes('3030') ||
                msg.includes('internal server error') ||
                msg.includes('overloaded') ||
                msg.includes('service unavailable');

            if (!isTransient || attempt === maxRetries) {
                throw error;
            }

            const delay = Math.min(
                BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 300,
                MAX_DELAY_MS
            );
            console.log(
                `AI.run transient error (attempt ${attempt}/${maxRetries}): ${error.message}. ` +
                `Retrying in ${Math.round(delay)}ms...`
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

function extractResponseText(response) {
    if (!response) return '';
    if (typeof response.response === 'string') return response.response;
    if (response.choices?.[0]?.message?.content) return response.choices[0].message.content;
    return '';
}

function extractToolCalls(response) {
    if (!response) return null;
    const calls = response.tool_calls || response.choices?.[0]?.message?.tool_calls || null;
    if (Array.isArray(calls) && calls.length === 0) return null;
    return calls;
}

export { repairJson, retryAIRun, resolveModel };

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return handleCORS();
        }

        const url = new URL(request.url);
        const path = url.pathname;

        if (path !== '/' && path !== '/health') {
            const expectedKey = env.API_KEY;
            if (expectedKey) {
                const authHeader = request.headers.get('Authorization');
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return jsonResponse({ error: { message: 'Missing Authorization header', type: 'auth_error' } }, 401);
                }
                const providedKey = authHeader.slice(7);
                if (providedKey !== expectedKey) {
                    return jsonResponse({ error: { message: 'Invalid API key', type: 'auth_error' } }, 401);
                }
            }
        }

        if (path === '/v1/models' && request.method === 'GET') {
            return handleListModels();
        }

        if (path === '/v1/chat/completions' && request.method === 'POST') {
            return handleChatCompletions(request, env, ctx);
        }

        if (path === '/v1/embeddings' && request.method === 'POST') {
            return handleEmbeddings(request, env);
        }

        if (path === '/v1/audio/transcriptions' && request.method === 'POST') {
            return handleTranscription(request, env);
        }

        if (path === '/v1/audio/speech' && request.method === 'POST') {
            return handleSpeech(request, env);
        }

        if (path === '/' || path === '/health') {
            const endpoints = ['/v1/models'];
            if (CONFIG.chat) endpoints.push('/v1/chat/completions');
            if (CONFIG.embedding) endpoints.push('/v1/embeddings');
            if (CONFIG.speech_to_text) endpoints.push('/v1/audio/transcriptions');
            if (CONFIG.text_to_speech) endpoints.push('/v1/audio/speech');
            return jsonResponse({
                status: 'ok',
                service: 'cloudflare-ai-openai-compatible',
                endpoints,
            });
        }

        return jsonResponse({ error: 'Not found' }, 404);
    },
};

function handleListModels() {
    const data = Object.entries(CONFIG).map(([type, cfId]) => ({
        id: type,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'cloudflare-workers-ai',
        type,
        backend: cfId,
    }));
    return jsonResponse({ object: 'list', data });
}

async function handleChatCompletions(request, env, ctx) {
    if (!CONFIG.chat) {
        return jsonResponse({ error: { message: 'Chat model is not configured. Add a "chat" entry to models.json.', type: 'invalid_request_error' } }, 404);
    }

    try {
        const body = await request.json();
        const { model, messages, stream = false, tools, max_tokens, max_completion_tokens, temperature, response_format, structured } = body;

        if (!model) {
            return jsonResponse({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
        }

        const cfModel = resolveModel(model, 'chat');
        if (!cfModel) {
            return jsonResponse({
                error: {
                    message: `Model '${model}' not found. Use 'chat' or '${CONFIG.chat}' for chat completions.`,
                    type: 'invalid_request_error',
                },
            }, 400);
        }

        if (!messages || !Array.isArray(messages)) {
            return jsonResponse({ error: { message: 'messages array is required', type: 'invalid_request_error' } }, 400);
        }

        const jsonMode = response_format?.type === 'json_object' || structured?.type === 'json';

        const sanitizedMessages = sanitizeMessages(messages);
        const processedMessages = jsonMode ? enforceJsonOutput(sanitizedMessages) : sanitizedMessages;

        const modelOptions = {
            messages: processedMessages,
            stream,
        };

        if (tools) modelOptions.tools = tools;

        const tokenLimit = max_completion_tokens ?? max_tokens;
        if (tokenLimit) modelOptions.max_tokens = tokenLimit;
        if (temperature !== undefined) modelOptions.temperature = temperature;

        if (stream) {
            const response = await retryAIRun(env, cfModel, modelOptions);
            const completionId = `chatcmpl-${crypto.randomUUID()}`;
            const created = Math.floor(Date.now() / 1000);
            const openaiStream = transformToOpenAIStream(response, cfModel, completionId, created);
            return new Response(openaiStream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    ...corsHeaders(),
                },
            });
        }

        // Non-streaming: in JSON mode, retry up to 3 times if the response isn't valid JSON
        const maxRetries = jsonMode ? 3 : 1;
        let lastError = null;
        let cleanedContent = null;
        let response = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            response = await retryAIRun(env, cfModel, modelOptions);

            if (jsonMode) {
                const extractedJson = extractJson(extractResponseText(response));
                const strippedJson = stripThinkTagsFromJson(extractedJson);
                cleanedContent = repairJson(strippedJson);
                try {
                    JSON.parse(cleanedContent);
                    break;
                } catch (e) {
                    lastError = e;
                    if (attempt < maxRetries) {
                        console.log(`JSON validation failed (attempt ${attempt}/${maxRetries}), retrying...`);
                        continue;
                    }
                }
            } else {
                cleanedContent = stripThinkTags(extractResponseText(response));
                break;
            }
        }

        if (jsonMode && lastError) {
            try {
                JSON.parse(cleanedContent);
            } catch {
                return jsonResponse({
                    error: {
                        message: 'Model failed to return valid JSON after multiple attempts',
                        type: 'server_error',
                    },
                }, 500);
            }
        }

        const usage = {
            prompt_tokens: response.usage?.prompt_tokens || 0,
            completion_tokens: response.usage?.completion_tokens || 0,
            total_tokens: response.usage?.total_tokens || 0,
        };

        return jsonResponse({
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: cfModel,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: cleanedContent,
                        tool_calls: extractToolCalls(response),
                    },
                    finish_reason: extractToolCalls(response) ? 'tool_calls' : 'stop',
                },
            ],
            usage,
        });
    } catch (error) {
        console.error('Chat completions error:', error);
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('3030')) {
            return jsonResponse({
                error: {
                    message: 'The input exceeded this model\'s context window. Please reduce your input.',
                    type: 'invalid_request_error',
                    code: 'context_length_exceeded',
                },
            }, 400);
        }
        return jsonResponse({ error: { message: error.message || 'Internal server error', type: 'server_error' } }, 500);
    }
}

async function handleEmbeddings(request, env) {
    if (!CONFIG.embedding) {
        return jsonResponse({ error: { message: 'Embedding model is not configured. Add an "embedding" entry to models.json.', type: 'invalid_request_error' } }, 404);
    }

    try {
        const body = await request.json();
        const { model, input } = body;

        if (!model) {
            return jsonResponse({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
        }
        const cfModel = resolveModel(model, 'embedding');
        if (!cfModel) {
            return jsonResponse({
                error: {
                    message: `Model '${model}' not found. Use 'embedding' or '${CONFIG.embedding}' for embeddings.`,
                    type: 'invalid_request_error',
                },
            }, 400);
        }
        if (!input) {
            return jsonResponse({ error: { message: 'input is required', type: 'invalid_request_error' } }, 400);
        }

        const texts = Array.isArray(input) ? input : [input];
        const response = await retryAIRun(env, cfModel, { text: texts });

        const embeddings = response.data.map((embedding, index) => ({
            object: 'embedding',
            index,
            embedding,
        }));

        const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
        const tokenCount = Math.ceil(totalChars / 4);

        return jsonResponse({
            object: 'list',
            data: embeddings,
            model: cfModel,
            usage: {
                prompt_tokens: tokenCount,
                total_tokens: tokenCount,
            },
        });
    } catch (error) {
        console.error('Embeddings error:', error);
        return jsonResponse({ error: { message: error.message || 'Internal server error', type: 'server_error' } }, 500);
    }
}

async function handleTranscription(request, env) {
    if (!CONFIG.speech_to_text) {
        return jsonResponse({ error: { message: 'Speech-to-text model is not configured. Add a "speech_to_text" entry to models.json.', type: 'invalid_request_error' } }, 404);
    }

    try {
        const contentType = request.headers.get('content-type') || '';
        let audioData;
        let audioContentType = null;
        let model = 'speech_to_text';
        let language = null;

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const file = formData.get('file') || formData.get('audio');
            if (!file) {
                return jsonResponse({ error: { message: 'audio file is required', type: 'invalid_request_error' } }, 400);
            }
            audioData = await file.arrayBuffer();
            if (file.type) audioContentType = file.type;
            language = formData.get('language');
            if (formData.get('model')) model = formData.get('model');
        } else if (contentType.includes('application/json')) {
            const body = await request.json();
            if (!body.audio) {
                return jsonResponse({ error: { message: 'audio field is required', type: 'invalid_request_error' } }, 400);
            }
            audioData = Uint8Array.from(atob(body.audio), c => c.charCodeAt(0)).buffer;
            audioContentType = body.content_type || null;
            language = body.language;
            if (body.model) model = body.model;
        } else {
            audioData = await request.arrayBuffer();
            if (contentType) audioContentType = contentType;
        }

        const cfModel = resolveModel(model, 'speech_to_text');
        if (!cfModel) {
            return jsonResponse({
                error: {
                    message: `Model '${model}' not found. Use 'speech_to_text' or '${CONFIG.speech_to_text}' for transcription.`,
                    type: 'invalid_request_error',
                },
            }, 400);
        }

        // STT input schemas differ by model: Deepgram (nova) takes
        // { audio: { body, contentType } } and nests the transcript under
        // results.channels[].alternatives[]; legacy Whisper models take a raw
        // byte array; whisper-large-v3-turbo takes base64. All but Deepgram
        // return a flat `text` field.
        const isDeepgram = cfModel.startsWith('@cf/deepgram/');
        const isLegacyWhisper =
            cfModel === '@cf/openai/whisper' || cfModel === '@cf/openai/whisper-tiny-en';
        let modelOptions;
        if (isDeepgram) {
            modelOptions = {
                audio: {
                    body: new Uint8Array(audioData),
                    contentType: audioContentType || 'audio/mpeg',
                },
            };
        } else if (isLegacyWhisper) {
            modelOptions = { audio: [...new Uint8Array(audioData)] };
        } else {
            const uint8Array = new Uint8Array(audioData);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64Audio = btoa(binary);
            modelOptions = { audio: base64Audio, task: 'transcribe' };
            if (language) modelOptions.language = language;
        }

        const response = await retryAIRun(env, cfModel, modelOptions);
        const text =
            response?.text ??
            response?.results?.channels?.[0]?.alternatives?.[0]?.transcript ??
            '';
        return jsonResponse({ text });
    } catch (error) {
        console.error('Transcription error:', error);
        return jsonResponse({ error: { message: error.message || 'Internal server error', type: 'server_error' } }, 500);
    }
}

async function handleSpeech(request, env) {
    if (!CONFIG.text_to_speech) {
        return jsonResponse({ error: { message: 'Text-to-speech model is not configured. Add a "text_to_speech" entry to models.json.', type: 'invalid_request_error' } }, 404);
    }

    try {
        const body = await request.json();
        const { model = 'text_to_speech', input, voice } = body;

        if (!input) {
            return jsonResponse({ error: { message: 'input is required', type: 'invalid_request_error' } }, 400);
        }

        const cfModel = resolveModel(model, 'text_to_speech');
        if (!cfModel) {
            return jsonResponse({
                error: {
                    message: `Model '${model}' not found. Use 'text_to_speech' or '${CONFIG.text_to_speech}' for speech.`,
                    type: 'invalid_request_error',
                },
            }, 400);
        }

        // TTS input schemas differ by model family: Deepgram Aura expects
        // { text, speaker? } and streams MPEG audio back; MeloTTS expects
        // { prompt, lang } and returns base64 WAV in a JSON `audio` field.
        const isDeepgram = cfModel.startsWith('@cf/deepgram/');
        const modelOptions = isDeepgram
            ? { text: input }
            : { prompt: input, lang: 'en' };
        if (voice) modelOptions.speaker = voice;

        const response = await retryAIRun(env, cfModel, modelOptions);

        let audioBytes;
        let mime = 'audio/wav';
        let filename = 'speech.wav';
        if (response && response.audio) {
            audioBytes = Uint8Array.from(atob(response.audio), c => c.charCodeAt(0));
        } else if (response instanceof ArrayBuffer || response instanceof Uint8Array) {
            audioBytes = new Uint8Array(response);
            if (isDeepgram) { mime = 'audio/mpeg'; filename = 'speech.mp3'; }
        } else {
            // ReadableStream (e.g. Aura) — pass straight through.
            audioBytes = response;
            if (isDeepgram) { mime = 'audio/mpeg'; filename = 'speech.mp3'; }
        }

        return new Response(audioBytes, {
            status: 200,
            headers: {
                'Content-Type': mime,
                'Content-Disposition': `attachment; filename="${filename}"`,
                ...corsHeaders(),
            },
        });
    } catch (error) {
        console.error('Speech error:', error);
        return jsonResponse({ error: { message: error.message || 'Internal server error', type: 'server_error' } }, 500);
    }
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

function handleCORS() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(),
        },
    });
}

function enforceJsonOutput(messages) {
    const jsonSystemPrompt = 'CRITICAL: You MUST respond with ONLY valid JSON. No markdown, no code blocks, no explanatory text. Output raw JSON only. Never wrap JSON in ```json``` or any other formatting.';

    const hasSystemMessage = messages.some(m => m.role === 'system');
    if (hasSystemMessage) {
        return messages.map(m => {
            if (m.role === 'system') {
                return { ...m, content: `${jsonSystemPrompt}\n\n${m.content}` };
            }
            return m;
        });
    }
    return [{ role: 'system', content: jsonSystemPrompt }, ...messages];
}

function extractJson(text) {
    if (!text) return text;
    try {
        JSON.parse(text);
        return text;
    } catch {}

    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        const extracted = codeBlockMatch[1].trim();
        try {
            JSON.parse(extracted);
            return extracted;
        } catch {}
    }

    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
        const extracted = jsonMatch[1].trim();
        try {
            JSON.parse(extracted);
            return extracted;
        } catch {}
    }

    return text;
}

function repairJson(text) {
    if (!text) return text;
    try {
        JSON.parse(text);
        return text;
    } catch {}

    let repaired = text;
    repaired = repaired.replace(/""\s*([^"{\[\],}])/g, ' $1');
    repaired = repaired.replace(/"\s+"(?=[a-zA-Z_])/g, '", "');
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    try {
        JSON.parse(repaired);
        return repaired;
    } catch {
        return text;
    }
}

function sanitizeMessages(messages) {
    const ROLE_MAP = {
        'systemmessage': 'system',
        'system_message': 'system',
        'humanmessage': 'user',
        'human_message': 'user',
        'human': 'user',
        'aimessage': 'assistant',
        'ai_message': 'assistant',
        'ai': 'assistant',
        'functionmessage': 'function',
        'toolmessage': 'tool',
        'tool_message': 'tool',
    };

    const thinkPatterns = [
        /<think>/gi,
        /<\/think>/gi,
        /\bthink\s*tags?\b/gi,
        /\b<think>.*?<\/think>\b/gis,
    ];

    return messages.map(msg => {
        const normalizedRole = ROLE_MAP[msg.role?.toLowerCase()] || msg.role;

        if (typeof msg.content !== 'string') {
            return { ...msg, role: normalizedRole };
        }

        let sanitized = msg.content;
        for (const pattern of thinkPatterns) {
            sanitized = sanitized.replace(pattern, '');
        }

        sanitized = sanitized.replace(/[A-Za-z0-9+/]{20,}={0,2}/g, (match) => {
            try {
                const decoded = atob(match);
                if (/<\/?think>/i.test(decoded)) return '';
            } catch {}
            return match;
        });

        return { ...msg, role: normalizedRole, content: sanitized.trim() };
    });
}

function stripThinkTags(text) {
    if (!text) return text;
    const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (stripped) return stripped;
    return text.replace(/<\/?think>/gi, '').trim();
}

function stripThinkTagsFromJson(text) {
    if (!text) return text;
    let cleaned = stripThinkTags(text);
    try {
        const parsed = JSON.parse(cleaned);
        return JSON.stringify(stripThinkTagsFromObject(parsed));
    } catch {
        return cleaned;
    }
}

function stripThinkTagsFromObject(obj) {
    if (typeof obj === 'string') return stripThinkTags(obj);
    if (Array.isArray(obj)) return obj.map(stripThinkTagsFromObject);
    if (obj && typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            cleaned[key] = stripThinkTagsFromObject(value);
        }
        return cleaned;
    }
    return obj;
}

function transformToOpenAIStream(inputStream, model, completionId, created) {
    let buffer = '';
    let inThinkBlock = false;
    let sentRole = false;
    let emittedContent = false;
    let thinkBuffer = '';

    function makeChunk(delta, finishReason = null) {
        return JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
        });
    }

    return new ReadableStream({
        async start(controller) {
            const reader = inputStream.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) {
                            if (line.trim() === '') {
                                controller.enqueue(encoder.encode('\n'));
                            }
                            continue;
                        }

                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            if (!emittedContent && thinkBuffer) {
                                const fallbackContent = thinkBuffer.replace(/<\/?think>/gi, '').trim();
                                if (fallbackContent) {
                                    const delta = {};
                                    if (!sentRole) { delta.role = 'assistant'; sentRole = true; }
                                    delta.content = fallbackContent;
                                    controller.enqueue(encoder.encode('data: ' + makeChunk(delta) + '\n\n'));
                                }
                            }
                            controller.enqueue(encoder.encode('data: ' + makeChunk({}, 'stop') + '\n\n'));
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                            continue;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.response ?? parsed.choices?.[0]?.delta?.content ?? '';

                            let filtered = content;
                            if (content.includes('<think>')) inThinkBlock = true;
                            if (inThinkBlock) {
                                thinkBuffer += content;
                                if (content.includes('</think>')) {
                                    inThinkBlock = false;
                                    filtered = content.split('</think>').pop() || '';
                                } else {
                                    filtered = '';
                                }
                            }

                            const delta = {};
                            if (!sentRole) { delta.role = 'assistant'; sentRole = true; }
                            if (filtered) {
                                delta.content = filtered;
                                emittedContent = true;
                            }
                            if (Object.keys(delta).length > 0) {
                                controller.enqueue(encoder.encode('data: ' + makeChunk(delta) + '\n\n'));
                            }
                        } catch {
                            // skip non-JSON lines
                        }
                    }
                }

                if (buffer.trim()) {
                    const line = buffer.trim();
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            if (!emittedContent && thinkBuffer) {
                                const fallbackContent = thinkBuffer.replace(/<\/?think>/gi, '').trim();
                                if (fallbackContent) {
                                    const delta = {};
                                    if (!sentRole) { delta.role = 'assistant'; sentRole = true; }
                                    delta.content = fallbackContent;
                                    controller.enqueue(encoder.encode('data: ' + makeChunk(delta) + '\n\n'));
                                }
                            }
                            controller.enqueue(encoder.encode('data: ' + makeChunk({}, 'stop') + '\n\n'));
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        }
                    }
                }
            } finally {
                reader.releaseLock();
                controller.close();
            }
        },
    });
}
