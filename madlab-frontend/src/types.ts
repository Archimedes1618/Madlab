export interface LogLine {
    id: number;
    type: string;
    payload: any;
    timestamp: string;
}

export interface MonitoringState {
    logs: LogLine[];
    metrics: any;
    files: Record<string, number>;
}

export interface ModelArtifact {
    name: string;
    url: string;
}
