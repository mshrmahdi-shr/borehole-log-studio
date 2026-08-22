export type EvidenceKind = "image" | "pdf" | "text";

export type EvidenceItem = {
  id: string;
  kind: EvidenceKind;
  name: string;
  size?: number;
  text?: string;
  createdAt: string;
};

export type AnalysisResult = {
  category: string;
  confidence: "Low" | "Medium" | "High";
  summary: string;
  found: string[];
  missing: string[];
};

export type AnswerMap = Record<string, string>;
