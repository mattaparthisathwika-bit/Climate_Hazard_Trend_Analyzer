import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function generateClimatePdfReport(analysis) {
  if (!analysis) return

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const { meta, summary, threshold_info, trends, decadal_summary, top_events, data_quality } = analysis
  const unitSym = meta.temperature_unit_symbol || '°C'
  const intensityUnit = meta.hazard_type === 'heavy_rainfall' ? 'mm' : meta.hazard_type === 'drought' ? 'days' : unitSym

  // Header Banner
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, 210, 36, 'F')

  doc.setTextColor(251, 191, 36)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('CLIMATE HAZARD TREND ANALYZER  |  DYGNIFY TECHNICAL INTELLIGENCE REPORT', 14, 11)

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.text(`${meta.region_name} (${meta.start_year}–${meta.end_year})`, 14, 21)

  doc.setTextColor(148, 163, 184)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(
    `Hazard: ${meta.hazard_type.toUpperCase()}  |  Center: ${meta.center_coordinates.latitude.toFixed(3)}°, ${meta.center_coordinates.longitude.toFixed(3)}°  |  Source: ${meta.data_source}`,
    14,
    29
  )

  // Headline Insight Box
  doc.setFillColor(254, 243, 199)
  doc.setDrawColor(245, 158, 11)
  doc.roundedRect(14, 42, 182, 20, 2, 2, 'FD')

  doc.setTextColor(146, 64, 14)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text('EXECUTIVE SUMMARY INSIGHT', 18, 48)

  doc.setTextColor(15, 23, 42)
  doc.setFontSize(11)
  const splitHeadline = doc.splitTextToSize(summary.headline, 174)
  doc.text(splitHeadline, 18, 55)

  // Domain Rule & Statistical Summary
  let yPos = 69
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text('1. Domain Rule & Statistical Trend Verification', 14, yPos)

  yPos += 5
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(51, 65, 85)
  const ruleLines = doc.splitTextToSize(`Detection Rule: ${threshold_info.rule_description}`, 182)
  doc.text(ruleLines, 14, yPos)
  yPos += ruleLines.length * 4.5 + 2

  const freqOls = trends.frequency.ols
  const freqMk = trends.frequency.mann_kendall
  const daysMk = trends.total_hazard_days.mann_kendall

  autoTable(doc, {
    startY: yPos,
    head: [['Metric', 'OLS Slope / Decade', 'OLS R² (p-val)', 'Mann-Kendall Z (p-val)', 'Sen\'s Slope / Decade', 'Trend Verdict']],
    body: [
      [
        'Annual Event Frequency',
        `${freqOls.slope_per_decade >= 0 ? '+' : ''}${freqOls.slope_per_decade} ev/dec`,
        `${freqOls.r_squared} (p=${freqOls.p_value})`,
        `Z=${freqMk.z_score} (p=${freqMk.p_value})`,
        `${freqMk.sens_slope_per_decade >= 0 ? '+' : ''}${freqMk.sens_slope_per_decade}`,
        freqMk.trend_direction,
      ],
      [
        'Annual Hazard Days',
        `${trends.total_hazard_days.ols.slope_per_decade >= 0 ? '+' : ''}${trends.total_hazard_days.ols.slope_per_decade} d/dec`,
        `${trends.total_hazard_days.ols.r_squared} (p=${trends.total_hazard_days.ols.p_value})`,
        `Z=${daysMk.z_score} (p=${daysMk.p_value})`,
        `${daysMk.sens_slope_per_decade >= 0 ? '+' : ''}${daysMk.sens_slope_per_decade}`,
        daysMk.trend_direction,
      ],
      [
        'Event Mean Duration',
        `${trends.duration.ols.slope_per_decade >= 0 ? '+' : ''}${trends.duration.ols.slope_per_decade} d/dec`,
        `${trends.duration.ols.r_squared} (p=${trends.duration.ols.p_value})`,
        `Z=${trends.duration.mann_kendall.z_score} (p=${trends.duration.mann_kendall.p_value})`,
        `${trends.duration.mann_kendall.sens_slope_per_decade}`,
        trends.duration.mann_kendall.trend_direction,
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5 },
    margin: { left: 14, right: 14 },
  })

  yPos = doc.lastAutoTable.finalY + 7

  // Key Findings & Critical Thinking Caveats
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text('2. Analytical Insights & Critical Thinking Caveats', 14, yPos)
  yPos += 5

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  summary.key_findings.forEach((item) => {
    const line = `• ${item.title}: ${item.detail}`
    const wrapped = doc.splitTextToSize(line, 182)
    doc.text(wrapped, 14, yPos)
    yPos += wrapped.length * 4 + 1.5
  })

  if (summary.critical_thinking_caveats?.length) {
    yPos += 1
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(100, 116, 139)
    summary.critical_thinking_caveats.forEach((cav) => {
      const wrapped = doc.splitTextToSize(`Note: ${cav}`, 182)
      doc.text(wrapped, 14, yPos)
      yPos += wrapped.length * 3.8 + 1.5
    })
  }

  yPos += 3
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text('3. Decadal Climate Hazard Summary', 14, yPos)
  yPos += 3

  autoTable(doc, {
    startY: yPos,
    head: [['Decade', 'Years Covered', 'Avg Events / Year', 'Avg Hazard Days / Year', 'Mean Duration (Days)', `Peak Intensity (${intensityUnit})`]],
    body: decadal_summary.map((d) => [
      d.decade,
      d.years_covered,
      d.avg_events_per_year,
      d.avg_hazard_days_per_year,
      d.avg_duration_days,
      d.max_peak_intensity,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
  })

  yPos = doc.lastAutoTable.finalY + 7

  // Top Detected Extreme Events Table
  if (top_events && top_events.length > 0) {
    if (yPos > 235) {
      doc.addPage()
      yPos = 18
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    doc.text('4. Top Historical Hazard Events (Ranked by Duration & Severity)', 14, yPos)
    yPos += 3

    autoTable(doc, {
      startY: yPos,
      head: [['Start Date', 'End Date', 'Duration (Days)', `Peak (${intensityUnit})`, `Threshold (${intensityUnit})`, 'Cumulative Excess', 'Severity']],
      body: top_events.slice(0, 12).map((ev) => [
        ev.start_date,
        ev.end_date,
        ev.duration_days,
        ev.peak_value,
        ev.threshold_ref,
        ev.cumulative_excess,
        ev.severity,
      ]),
      theme: 'grid',
      headStyles: { fillColor: [180, 83, 9], fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
      margin: { left: 14, right: 14 },
    })
    yPos = doc.lastAutoTable.finalY + 6
  }

  // Footer with Data Hygiene metadata
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(148, 163, 184)
    doc.text(
      `Data Quality: ${data_quality.total_days_in_span} days analyzed | Completeness: ${data_quality.usable_completeness_pct}% | Gaps interpolated: ${data_quality.interpolated_short_gap_days} | Page ${i} of ${pageCount}`,
      14,
      290
    )
  }

  const safeRegion = meta.region_name.replace(/[^a-zA-Z0-9]/g, '_')
  doc.save(`Climate_Hazard_Report_${meta.hazard_type}_${safeRegion}_${meta.start_year}_${meta.end_year}.pdf`)
}

