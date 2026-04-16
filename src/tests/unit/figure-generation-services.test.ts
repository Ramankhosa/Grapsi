import { describe, expect, it } from 'vitest'

import { buildAcademicChartConfig } from '../../lib/figure-generation/quickchart-service'
import {
  figureDataToPythonSpec,
  isPublicationGradePythonPlotType,
} from '../../lib/figure-generation/python-chart-service'

describe('figure generation services', () => {
  it('preserves LLM chart config options while filling academic defaults', () => {
    const config = buildAcademicChartConfig(
      {
        type: 'bar',
        data: {
          labels: ['Baseline', 'Proposed'],
          datasets: [
            {
              label: 'Accuracy',
              data: [84.1, 89.7],
              borderWidth: 2.4,
            },
          ],
        },
        options: {
          plugins: {
            title: {
              display: true,
              text: 'Model Accuracy Comparison',
            },
          },
          scales: {
            x: {
              title: {
                display: true,
                text: 'Method',
              },
            },
            y: {
              title: {
                display: true,
                text: 'Accuracy (%)',
              },
            },
          },
        },
      },
      {
        theme: { preset: 'academic' },
      }
    )

    expect(config.options?.plugins?.title?.text).toBe('Model Accuracy Comparison')
    expect(config.options?.plugins?.legend?.display).toBe(true)
    expect(config.options?.scales?.x?.title?.text).toBe('Method')
    expect(config.options?.scales?.y?.title?.text).toBe('Accuracy (%)')
    expect(config.data.datasets[0].borderWidth).toBe(2.4)
    expect(config.data.datasets[0].backgroundColor).toBeTruthy()
  })

  it('maps ROC curve data to the Python renderer spec', () => {
    const spec = figureDataToPythonSpec(
      'roc_curve',
      {
        curves: [
          {
            label: 'Model A',
            fpr: [0, 0.1, 0.3, 1],
            tpr: [0, 0.6, 0.85, 1],
            auc: 0.91,
          },
        ],
      },
      {
        title: 'ROC Comparison',
      }
    )

    expect(spec?.plotType).toBe('roc_curve')
    expect(spec?.data.curves).toHaveLength(1)
    expect(spec?.xAxisLabel).toBe('False Positive Rate')
    expect(spec?.yAxisLabel).toBe('True Positive Rate')
  })

  it('maps Bland-Altman and forest plot data to Python renderer specs', () => {
    const blandAltman = figureDataToPythonSpec('bland_altman', {
      method1: [1.1, 2.0, 3.2],
      method2: [1.0, 2.1, 3.1],
    })

    const forest = figureDataToPythonSpec('forest_plot', {
      studies: [
        { label: 'Study 1', effect: 0.42, ci_low: 0.1, ci_high: 0.74, weight: 1.2 },
        { label: 'Summary', effect: 0.36, ci_low: 0.2, ci_high: 0.52, weight: 2.0, type: 'summary' },
      ],
    })

    expect(blandAltman?.plotType).toBe('bland_altman')
    expect(blandAltman?.data.method1).toEqual([1.1, 2.0, 3.2])
    expect(forest?.plotType).toBe('forest_plot')
    expect(forest?.data.studies).toHaveLength(2)
    expect(forest?.figureSize).toBe('double_column')
  })

  it('treats histogram as unsupported for publication-grade statistical rendering', () => {
    expect(isPublicationGradePythonPlotType('roc_curve')).toBe(true)
    expect(isPublicationGradePythonPlotType('histogram')).toBe(false)
  })
})
