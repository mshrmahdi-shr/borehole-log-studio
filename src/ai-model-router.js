const GEMINI_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const nativeFetch = window.fetch.bind(window);
const MODEL_CACHE_MS = 10 * 60 * 1000;

let modelCache = { key: '', at: 0, models: [] };

function modelName(model) {
  return String(model?.name || model || '').replace(/^models\//, '');
}

function supportsGenerateContent(model) {
  return Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent');
}

function modelScore(model) {
  const name = modelName(model).toLowerCase();
  if (!name.includes('gemini')) return -1000;
  if (/(embedding|aqa|imagen|veo|tts|live|robotics|nano|gemma)/.test(name)) return -900;
  let score = 100;
  if (name.includes('flash')) score += 80;
  if (name.includes('pro')) score += 65;
  if (name.includes('vision')) score += 25;
  if (name.includes('latest')) score += 20;
  if (name.includes('preview')) score += 5;
  if (name.includes('exp')) score -= 10;
  return score;
}

function setAiStatus(message) {
  const status = document.getElementById('aiStatus');
  if (status) status.textContent = message;
}

function fillModelList(models) {
  const list = document.getElementById('aiModelOptions');
  if (!list) return;
  list.innerHTML = models.map(m => `<option value="${modelName(m)}"></option>`).join('');
}

async function discoverModels(key, force = false) {
  if (!key) throw new Error('Enter a Gemini API key first.');
  const now = Date.now();
  if (!force && modelCache.key === key && now - modelCache.at < MODEL_CACHE_MS && modelCache.models.length) {
    return modelCache.models;
  }

  const response = await nativeFetch(`${GEMINI_MODELS_ENDPOINT}?pageSize=1000&key=${encodeURIComponent(key)}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Model discovery ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = await response.json();
  const models = (payload.models || [])
    .filter(supportsGenerateContent)
    .filter(m => modelScore(m) > 0)
    .sort((a, b) => modelScore(b) - modelScore(a));

  if (!models.length) throw new Error('No Gemini generateContent model is available for this API key.');
  modelCache = { key, at: now, models };
  fillModelList(models);
  return models;
}

function replaceModelInUrl(url, model) {
  return url.replace(/\/models\/[^/:?]+:generateContent/i, `/models/${encodeURIComponent(model)}:generateContent`);
}

function parseGeminiRequest(url) {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.hostname !== 'generativelanguage.googleapis.com') return null;
    const match = parsed.pathname.match(/\/v1beta\/models\/([^/:]+):generateContent$/i);
    if (!match) return null;
    return {
      key: parsed.searchParams.get('key') || '',
      requestedModel: decodeURIComponent(match[1]),
      url: parsed.toString()
    };
  } catch {
    return null;
  }
}

async function tryModels(originalUrl, init, key, requestedModel) {
  const models = await discoverModels(key, true);
  const names = models.map(modelName);
  const requested = String(requestedModel || '').trim();
  const candidates = [];

  if (requested && requested.toLowerCase() !== 'auto' && names.includes(requested)) candidates.push(requested);
  for (const name of names) if (!candidates.includes(name)) candidates.push(name);

  let lastResponse = null;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    setAiStatus(`Trying Gemini model ${candidate}${i ? ' (fallback)' : ''}…`);
    const response = await nativeFetch(replaceModelInUrl(originalUrl, candidate), init);
    lastResponse = response;

    if (response.ok) {
      const field = document.getElementById('aiModel');
      if (field) field.value = candidate;
      sessionStorage.setItem('blsGeminiResolvedModel', candidate);
      setAiStatus(`Connected to ${candidate}.`);
      return response;
    }

    // Authentication, permission and quota errors are not model-selection problems.
    if ([401, 403, 429].includes(response.status)) return response;

    // 400/404 may mean a retired model or an incompatible model. Try the next candidate.
    if (![400, 404].includes(response.status)) return response;
  }

  return lastResponse || nativeFetch(originalUrl, init);
}

window.fetch = async function routedGeminiFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url;
  const info = parseGeminiRequest(url);
  if (!info) return nativeFetch(input, init);

  const requested = info.requestedModel;
  if (requested.toLowerCase() === 'auto') {
    return tryModels(info.url, init, info.key, '');
  }

  const first = await nativeFetch(input, init);
  if (first.ok || ![400, 404].includes(first.status)) return first;

  setAiStatus(`${requested} is unavailable. Finding a compatible Gemini model…`);
  try {
    return await tryModels(info.url, init, info.key, requested);
  } catch (error) {
    console.error('Gemini model fallback failed', error);
    setAiStatus(error.message);
    return first;
  }
};

async function refreshModels() {
  const key = document.getElementById('aiKey')?.value.trim();
  const button = document.getElementById('refreshAiModels');
  if (button) button.disabled = true;
  try {
    setAiStatus('Checking models available to this API key…');
    const models = await discoverModels(key, true);
    const recommended = modelName(models[0]);
    const field = document.getElementById('aiModel');
    if (field) field.value = recommended;
    sessionStorage.setItem('blsGeminiResolvedModel', recommended);
    setAiStatus(`${models.length} compatible model(s) found. Recommended: ${recommended}.`);
  } catch (error) {
    console.error(error);
    setAiStatus(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const model = document.getElementById('aiModel');
  const saved = sessionStorage.getItem('blsGeminiResolvedModel');
  if (model) model.value = saved || 'auto';
  document.getElementById('refreshAiModels')?.addEventListener('click', refreshModels);
});
