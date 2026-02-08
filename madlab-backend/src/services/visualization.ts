import { promises as fsPromises } from 'fs';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { JudgeReport } from './types/evaluation';

export async function generateGraph(judgeReport: JudgeReport, outputPath: string): Promise<void> {
    
    const width = 1000;
    const height = 600;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

    const data = {
        labels: ['Model'],
        datasets: [
            {
                label: 'Static Accuracy',
                data: [judgeReport.static_accuracy],
                backgroundColor: 'rgba(255, 165, 0, 0.6)',
                yAxisID: 'y1'
            },
            {
                label: 'MagicJudge Score',
                data: [judgeReport.average_score],
                backgroundColor: 'rgba(66, 135, 245, 0.6)',
                yAxisID: 'y2'
            },
            {
                label: 'RDI',
                data: [judgeReport.capability_index],
                backgroundColor: 'rgba(120, 220, 120, 0.6)',
                yAxisID: 'y3'
            },
            {
                label: 'Label-Aligned Quality',
                data: [judgeReport.quality_label],
                backgroundColor: 'rgba(200, 120, 255, 0.6)',
                yAxisID: 'y4'
            },
            {
                label: 'Derivation Quality',
                data: [judgeReport.quality_derivation],
                backgroundColor: 'rgba(255, 80, 150, 0.6)',
                yAxisID: 'y5'
            }
        ]
    };

    const config = {
        type: 'bar' as const,
        data,
        options: {
            plugins: {
                title: {
                    display: true,
                    text: `Model Evaluation Graph: ${judgeReport.model}-${judgeReport.quantization}`,
                    font: { size: 22 }
                }
            },
            scales: {
                y1: { type: 'linear' as const, position: 'left' as const, min: 0, max: 1, title: { display: true, text: 'Static Accuracy' } },
                y2: { type: 'linear' as const, position: 'left' as const, min: 0, max: 10, title: { display: true, text: 'MagicJudge Score' } },
                y3: {
                    type: 'linear' as const, position: 'right' as const, min: 0, max: 100,
                    title: { display: true, text: 'Repetition - Derivation Index' },
                    grid: { drawOnChartArea: false },
                    ticks: {
                        callback: function(value: string | number) {
                            const v = Number(value);
                            if (v === 0) return 'Pure Repetition';
                            if (v === 25) return 'Mostly Repetition';
                            if (v === 50) return 'Balanced';
                            if (v === 75) return 'Mostly Derivation';
                            if (v === 100) return 'Pure Derivation';
                            return '';
                        }
                    }
                },
                y4: { type: 'linear' as const, position: 'right' as const, min: 0, max: 1, title: { display: true, text: 'Label-Aligned Quality' }, grid: { drawOnChartArea: false } },
                y5: { type: 'linear' as const, position: 'right' as const, min: 0, max: 1, title: { display: true, text: 'Derivation Quality' }, grid: { drawOnChartArea: false } }
            }
        }
    };

    const buffer = await chartJSNodeCanvas.renderToBuffer(config);
    await fsPromises.writeFile(outputPath, buffer);
}
