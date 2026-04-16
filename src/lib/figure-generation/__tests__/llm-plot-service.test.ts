import { describe, expect, it } from 'vitest'

import { validateChartConfig } from '../llm-figure-service'
import {
  hasResolvedExplicitChartData,
  resolveChartGenerationInput,
  toFigureDataPayload,
  validateCustomPythonPlotCode,
} from '../llm-plot-service'

describe('llm plot service', () => {
  it('resolves scatter payload data into point datasets', () => {
    const resolved = resolveChartGenerationInput(
      'scatter',
      {
        xValues: [1, 2, 3],
        yValues: [4, 5, 6],
      },
      null,
      'Accuracy vs Time'
    )

    expect(resolved.source).toBe('payload')
    expect(resolved.pointDatasets).toEqual([
      {
        label: 'Accuracy vs Time',
        data: [
          { x: 1, y: 4 },
          { x: 2, y: 5 },
          { x: 3, y: 6 },
        ],
      },
    ])
  })

  it('parses raw chart rows from request text', () => {
    const resolved = resolveChartGenerationInput(
      'bar',
      null,
      'Method,Score\nBaseline,72\nProposed,81',
      'Model Accuracy'
    )

    expect(resolved.source).toBe('request_text')
    expect(resolved.labels).toEqual(['Baseline', 'Proposed'])
    expect(resolved.datasets).toEqual([
      {
        label: 'Score',
        data: [72, 81],
      },
    ])
  })

  it('falls back to raw request text when the input is numeric but messy', () => {
    const resolved = resolveChartGenerationInput(
      'line',
      null,
      'Epoch 1 reached 0.71, epoch 2 reached 0.76, epoch 3 reached 0.82. Plot validation accuracy over epochs.',
      'Validation Accuracy'
    )

    expect(resolved.source).toBe('raw_request')
    expect(resolved.rawDataText).toContain('epoch 3')
    expect(hasResolvedExplicitChartData(resolved)).toBe(false)
  })

  it('converts parsed categorical chart input into a persistable figure payload', () => {
    const resolved = resolveChartGenerationInput(
      'bar',
      null,
      'Method,Score\nBaseline,72\nProposed,81',
      'Model Accuracy'
    )

    expect(toFigureDataPayload(resolved)).toEqual({
      labels: ['Baseline', 'Proposed'],
      datasets: [
        {
          label: 'Score',
          data: [72, 81],
        },
      ],
    })
  })

  it('rejects unsafe custom matplotlib code', () => {
    const validation = validateCustomPythonPlotCode("import os\nax.plot([1, 2], [3, 4])")

    expect(validation.valid).toBe(false)
    expect(validation.error).toMatch(/not allowed/i)
  })

  it('rejects matplotlib code that renders a top title', () => {
    const validation = validateCustomPythonPlotCode("ax.plot([1, 2], [3, 4])\nax.set_title('Results')")

    expect(validation.valid).toBe(false)
    expect(validation.error).toMatch(/title/i)
  })

  it('preserves scatter point objects during chart validation', () => {
    const validation = validateChartConfig({
      type: 'scatter',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Series A',
            data: [
              { x: 1, y: 2 },
              { x: 2, y: 4 },
            ],
          },
        ],
      },
      options: {},
    })

    expect(validation.valid).toBe(true)
    expect(validation.config?.data?.datasets?.[0]?.data).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ])
    expect(validation.config?.options?.plugins?.title?.display).toBe(false)
  })
})
