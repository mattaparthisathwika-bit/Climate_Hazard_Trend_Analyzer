import React, { useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Chart, Bar, Line } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler
)

const commonGridColor = 'rgba(148, 163, 184, 0.1)'
const commonTickColor = '#94a3b8'

export default function TrendCharts({ analysis }) {
  const [freqMetric, setFreqMetric] = useState('events') // 'events' | 'days'

  if (!analysis || !analysis.annual_series) return null

  const { annual_series, monthly_distribution, decadal_summary, meta, trends } = analysis
  const years = annual_series.map((r) => r.year)
  const tempSym = meta.temperature_unit_symbol || '°C'
  const intensityUnit =
    meta.hazard_type === 'heavy_rainfall'
      ? 'mm'
      : meta.hazard_type === 'drought'
      ? 'days'
      : tempSym

  const hazardColor =
    meta.hazard_type === 'heatwave'
      ? { bar: 'rgba(245, 158, 11, 0.45)', border: '#f59e0b', roll: '#ef4444', trend: '#38bdf8' }
      : meta.hazard_type === 'heavy_rainfall'
      ? { bar: 'rgba(56, 189, 248, 0.45)', border: '#38bdf8', roll: '#818cf8', trend: '#fbbf24' }
      : { bar: 'rgba(217, 119, 6, 0.45)', border: '#d97706', roll: '#f97316', trend: '#34d399' }

  // 1. Primary Frequency / Exposure Time-Series Chart
  const isEventsMode = freqMetric === 'events'
  const primaryChartData = {
    labels: years,
    datasets: [
      {
        type: 'bar',
        label: isEventsMode ? 'Annual Hazard Events' : 'Total Annual Hazard Days',
        data: annual_series.map((r) => (isEventsMode ? r.event_count : r.total_hazard_days)),
        backgroundColor: hazardColor.bar,
        borderColor: hazardColor.border,
        borderWidth: 1,
        borderRadius: 3,
        order: 3,
      },
      {
        type: 'line',
        label: '5-Year Rolling Average',
        data: annual_series.map((r) => (isEventsMode ? r.freq_rolling_5yr : r.days_rolling_5yr)),
        borderColor: hazardColor.roll,
        backgroundColor: hazardColor.roll,
        borderWidth: 2.5,
        pointRadius: 2,
        tension: 0.35,
        spanGaps: true,
        order: 1,
      },
      {
        type: 'line',
        label: `OLS Linear Regression (${
          isEventsMode
            ? `${trends.frequency.ols.slope_per_decade >= 0 ? '+' : ''}${trends.frequency.ols.slope_per_decade} ev/dec`
            : `${trends.total_hazard_days.ols.slope_per_decade >= 0 ? '+' : ''}${trends.total_hazard_days.ols.slope_per_decade} d/dec`
        })`,
        data: annual_series.map((r) => (isEventsMode ? r.freq_trend_ols : r.days_trend_ols)),
        borderColor: hazardColor.trend,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0,
        order: 2,
      },
    ],
  }

  const primaryChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { color: '#e2e8f0', font: { size: 11, family: 'Inter' }, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: '#334155',
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        grid: { color: commonGridColor },
        ticks: { color: commonTickColor, maxTicksLimit: 12 },
      },
      y: {
        beginAtZero: true,
        grid: { color: commonGridColor },
        ticks: { color: commonTickColor },
        title: {
          display: true,
          text: isEventsMode ? 'Events / Year' : 'Total Hazard Days / Year',
          color: '#94a3b8',
          font: { size: 11 },
        },
      },
    },
  }

  // 2. Duration & Peak Intensity Dual-Axis Chart
  const durationIntensityData = {
    labels: years,
    datasets: [
      {
        label: 'Mean Event Duration (Days)',
        data: annual_series.map((r) => r.mean_duration_days),
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168, 85, 247, 0.14)',
        borderWidth: 2,
        pointRadius: 2.5,
        fill: true,
        tension: 0.3,
        yAxisID: 'yDuration',
      },
      {
        label: 'Max Event Streak (Days)',
        data: annual_series.map((r) => r.max_duration_days),
        borderColor: '#ec4899',
        borderWidth: 1.5,
        borderDash: [3, 3],
        pointRadius: 1.5,
        tension: 0.25,
        yAxisID: 'yDuration',
      },
      {
        label: `Peak Intensity (${intensityUnit})`,
        data: annual_series.map((r) => r.peak_intensity),
        borderColor: '#fbbf24',
        backgroundColor: '#fbbf24',
        borderWidth: 2.2,
        pointRadius: 2.5,
        tension: 0.25,
        yAxisID: 'yIntensity',
      },
      {
        label: `Peak Intensity OLS Trend`,
        data: annual_series.map((r) => r.peak_trend_ols),
        borderColor: '#34d399',
        borderWidth: 1.8,
        borderDash: [6, 4],
        pointRadius: 0,
        yAxisID: 'yIntensity',
      },
    ],
  }

  const durationIntensityOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { color: '#e2e8f0', font: { size: 11, family: 'Inter' }, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: '#334155',
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        grid: { color: commonGridColor },
        ticks: { color: commonTickColor, maxTicksLimit: 12 },
      },
      yDuration: {
        type: 'linear',
        display: true,
        position: 'left',
        beginAtZero: true,
        grid: { color: commonGridColor },
        ticks: { color: '#c084fc' },
        title: { display: true, text: 'Duration (Days)', color: '#c084fc', font: { size: 11 } },
      },
      yIntensity: {
        type: 'linear',
        display: true,
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { color: '#fbbf24' },
        title: {
          display: true,
          text: `Peak Intensity (${intensityUnit})`,
          color: '#fbbf24',
          font: { size: 11 },
        },
      },
    },
  }

  // 3. Decadal Comparison Bar Chart
  const decadalData = {
    labels: decadal_summary.map((d) => `${d.decade} (${d.years_covered})`),
    datasets: [
      {
        label: 'Avg Events / Year',
        data: decadal_summary.map((d) => d.avg_events_per_year),
        backgroundColor: 'rgba(245, 158, 11, 0.75)',
        borderColor: '#f59e0b',
        borderWidth: 1,
        borderRadius: 5,
      },
      {
        label: 'Avg Hazard Days / Year',
        data: decadal_summary.map((d) => d.avg_hazard_days_per_year),
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
        borderColor: '#ef4444',
        borderWidth: 1,
        borderRadius: 5,
      },
    ],
  }

  // 4. Monthly Seasonality Distribution Chart
  const monthlyData = {
    labels: monthly_distribution.map((m) => m.month_name),
    datasets: [
      {
        label: 'Total Hazard Days by Calendar Month',
        data: monthly_distribution.map((m) => m.total_hazard_days),
        backgroundColor: 'rgba(56, 189, 248, 0.65)',
        borderColor: '#38bdf8',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Discrete Events Count',
        data: monthly_distribution.map((m) => m.event_count),
        backgroundColor: 'rgba(251, 191, 36, 0.75)',
        borderColor: '#fbbf24',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  }

  const barSmallOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { color: '#e2e8f0', font: { size: 11, family: 'Inter' }, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: '#334155',
        borderWidth: 1,
      },
    },
    scales: {
      x: { grid: { color: commonGridColor }, ticks: { color: commonTickColor } },
      y: { beginAtZero: true, grid: { color: commonGridColor }, ticks: { color: commonTickColor } },
    },
  }

  return (
    <div className="space-y-6">
      {/* Chart 1: Frequency / Exposure Time-Series with Rolling Avg & Regression */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-100">
              Historical Hazard Frequency & Rolling Trend ({meta.start_year}–{meta.end_year})
            </h3>
            <p className="text-xs text-slate-400">
              Annual detections overlaid with 5-year rolling average and Ordinary Least Squares (OLS) linear regression
            </p>
          </div>
          <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800 self-start">
            <button
              type="button"
              onClick={() => setFreqMetric('events')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                isEventsMode
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Events / Year
            </button>
            <button
              type="button"
              onClick={() => setFreqMetric('days')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                !isEventsMode
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Total Hazard Days / Year
            </button>
          </div>
        </div>

        <div className="h-[320px] w-full">
          <Chart type="bar" data={primaryChartData} options={primaryChartOptions} />
        </div>
      </div>

      {/* Chart 2: Duration & Peak Intensity Evolution */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-100">
            Hazard Duration & Peak Intensity Trajectory
          </h3>
          <p className="text-xs text-slate-400">
            Dual-axis time series tracking event persistence (mean & longest streak in days) alongside annual peak intensity ({intensityUnit})
          </p>
        </div>
        <div className="h-[300px] w-full">
          <Line data={durationIntensityData} options={durationIntensityOptions} />
        </div>
      </div>

      {/* Charts 3 & 4: Decadal Breakdown & Monthly Seasonality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-slate-100">Decadal Escalation Profile</h3>
            <p className="text-xs text-slate-400">
              Multi-decade comparison of mean annual hazard events and total exposure days
            </p>
          </div>
          <div className="h-[250px] w-full">
            <Bar data={decadalData} options={barSmallOptions} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-slate-100">Monthly Seasonality Fingerprint</h3>
            <p className="text-xs text-slate-400">
              Calendar month distribution revealing the primary seasonal hazard window
            </p>
          </div>
          <div className="h-[250px] w-full">
            <Bar data={monthlyData} options={barSmallOptions} />
          </div>
        </div>
      </div>
    </div>
  )
}

