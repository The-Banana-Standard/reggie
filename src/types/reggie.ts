export interface AgentInfo {
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  memory: string | null;
  filePath: string;
  isPipelineManager: boolean;
}

export interface CommandInfo {
  name: string;
  description: string;
  commandType: string;
  source: string;
  filePath: string;
  manager: string | null;
}

export interface PipelineInfo {
  name: string;
  description: string;
  commandFilePath: string;
  managerName: string | null;
  managerFilePath: string | null;
}
