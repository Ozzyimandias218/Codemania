export interface TtsSynthesisRequest {
  text: string;
  language: string;
  voiceId: string;
  assetId: string;
}

export interface TtsSynthesisResult {
  audioUrl: string;
}

export interface TtsProvider {
  synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult>;
}
