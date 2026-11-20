import { env } from '../../config/env.ts';
import { TtsProvider, TtsSynthesisRequest, TtsSynthesisResult } from './tts.provider.ts';

/**
 * SINGLE ADAPTER FILE for HuggingFace TTS Inference Endpoint.
 *
 * All request and response mapping between Codemania and the external HF TTS
 * endpoint lives exclusively in this file. When the final HF endpoint API
 * contract is supplied, update only `buildRequestPayload` and `mapResponse`.
 *
 * Security: `HF_TOKEN` is read solely from server environment variables and
 * is never serialized or returned to clients.
 */
export class HuggingFaceTtsProvider implements TtsProvider {
  private readonly endpointUrl: string;
  private readonly token: string;
  private readonly publicBaseUrl: string;

  constructor(
    endpointUrl: string = env.HF_ENDPOINT_URL,
    token: string = env.HF_TOKEN,
    publicBaseUrl: string = env.AUDIO_PUBLIC_BASE_URL,
  ) {
    this.endpointUrl = endpointUrl;
    this.token = token;
    this.publicBaseUrl = publicBaseUrl;
  }

  private buildRequestPayload(req: TtsSynthesisRequest): Record<string, unknown> {
    return {
      inputs: req.text,
      parameters: {
        language: req.language,
        voice_id: req.voiceId,
      },
    };
  }

  private async mapResponse(response: Response, req: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`TTS endpoint failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = (await response.json()) as { audio_url?: string; url?: string };
      const url = json.audio_url ?? json.url;
      if (!url) {
        throw new Error('TTS JSON response missing audio_url/url');
      }
      return { audioUrl: url };
    }

    // Binary audio stream contract placeholder: persist or map to asset URL
    // In production, upload buffer to object storage (S3/GCS) and return signed/CDN URL.
    await response.arrayBuffer();
    const base = this.publicBaseUrl.replace(/\/$/, '');
    return { audioUrl: `${base}/${req.assetId}.wav` };
  }

  async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    if (!this.endpointUrl) {
      throw new Error('HF_ENDPOINT_URL is not configured');
    }
    if (!this.token) {
      throw new Error('HF_TOKEN is not configured');
    }

    const payload = this.buildRequestPayload(request);
    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return this.mapResponse(response, request);
  }
}
