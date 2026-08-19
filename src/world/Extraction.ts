export interface ExtractionState {
  active: boolean;
  siteId: string | null;
  progress: number;
  unlocked: boolean;
  paid: boolean;
}

export interface ExtractSite {
  id: string;
  areaId: string;
  x: number;
  z: number;
  label: string;
}
