import { format } from "date-fns";
import type { LegData, OverflightResult, VisaCheckResult, PetCheckResult } from "./tripTypes";
import type { FlightLegCalculation } from "@/lib/flightCalculations";

interface PrintableReportProps {
  aircraftType: string;
  flightType: string;
  legs: LegData[];
  overflightResults: Record<number, OverflightResult | null>;
  visaNationalities: string[];
  visaResults: Record<string, VisaCheckResult | null>;
  totalCharges: number;
  totalOverflightCharges: number;
  petTypes: string[];
  petResults: Record<string, PetCheckResult | null>;
  logoDataUrl?: string;
  flightCalcs?: Record<number, FlightLegCalculation>;
}

export function generatePrintableHtml({
  aircraftType,
  flightType,
  legs,
  overflightResults,
  visaNationalities,
  visaResults,
  totalCharges,
  totalOverflightCharges,
  petTypes,
  petResults,
  logoDataUrl,
  flightCalcs,
}: PrintableReportProps): string {
  const now = format(new Date(), "dd MMM yyyy HH:mm");
  const allFeasible = legs.every(l => l.feasibilityResult?.feasible !== false);
  const anyChecked = legs.some(l => l.feasibilityResult != null);

  const flightTypeLabel: Record<string, string> = {
    private: "Private (Non-Commercial)",
    "non-scheduled-commercial": "Non-Scheduled Commercial",
    commercial: "Commercial (Scheduled)",
  };

  function esc(s: string | null | undefined) {
    return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderLeg(leg: LegData, idx: number) {
    const isFirst = idx === 0;
    const isLast = idx === legs.length - 1;
    const showArrival = legs.length === 1 || !isFirst;
    const showDeparture = legs.length === 1 || !isLast;
    const feas = leg.feasibilityResult;

    let feasBadge = "";
    if (feas) {
      feasBadge = feas.feasible
        ? `<span class="badge badge-ok">✓ Feasible</span>`
        : `<span class="badge badge-fail">✗ Not Feasible</span>`;
    }

    let detailsHtml = "";

    // Dates
    const dateParts: string[] = [];
    if (showArrival && leg.arrivalDate) dateParts.push(`Arrival: ${format(leg.arrivalDate, "dd MMM yyyy")} ${leg.arrivalTime || ""}`);
    if (showDeparture && leg.departureDate) dateParts.push(`Departure: ${format(leg.departureDate, "dd MMM yyyy")} ${leg.departureTime || ""}`);
    if (dateParts.length) detailsHtml += `<p class="detail">${dateParts.join(" &nbsp;|&nbsp; ")}</p>`;

    // Toggles
    const toggles = [
      leg.permitRequired ? "Permit Required" : null,
      leg.pprRequired ? "PPR Required" : null,
      leg.customsAvailable ? "Customs Available" : "No Customs",
    ].filter(Boolean);
    detailsHtml += `<p class="detail">${toggles.join(" &nbsp;|&nbsp; ")}</p>`;

    // CBP
    if (leg.cbpResult?.found) {
      detailsHtml += `<div class="result-box">
        <p class="result-title">CBP — ${esc(leg.cbpResult.airportName)} (${esc(leg.cbpResult.icao)})</p>
        <p>${esc(leg.cbpResult.message)}</p>
        ${leg.cbpResult.operatingHours ? `<p>Hours: ${esc(leg.cbpResult.operatingHours.open)}–${esc(leg.cbpResult.operatingHours.close)} (${esc(leg.cbpResult.operatingHours.days)})</p>` : ""}
      </div>`;
    }

    // CIQ
    if (leg.ciqResult?.success) {
      detailsHtml += `<div class="result-box">
        <p class="result-title">CIQ — ${esc(leg.ciqResult.airportName || leg.ciqResult.country || leg.ciqResult.icao)}</p>
        <p>Available: ${esc(leg.ciqResult.ciqAvailable || "unknown")}</p>
        ${leg.ciqResult.operatingHours ? `<p>Hours: ${esc(leg.ciqResult.operatingHours)}</p>` : ""}
        ${leg.ciqResult.advanceNotice ? `<p>Notice: ${esc(leg.ciqResult.advanceNotice)}</p>` : ""}
        ${leg.ciqResult.notes ? `<p class="note">${esc(leg.ciqResult.notes)}</p>` : ""}
      </div>`;
    }

    // Permit
    if (leg.permitResult?.success) {
      detailsHtml += `<div class="result-box">
        <p class="result-title">Landing Permit — ${esc(leg.permitResult.country || leg.permitResult.icao)}</p>
        <p>Required: ${leg.permitResult.permitRequired === "yes" ? "⚠️ Yes" : leg.permitResult.permitRequired === "no" ? "✅ No" : "⚠️ Conditional"}</p>
        ${leg.permitResult.permitType ? `<p>Type: ${esc(leg.permitResult.permitType)}</p>` : ""}
        ${leg.permitResult.leadTimeDays != null ? `<p>Lead time: ${leg.permitResult.leadTimeDays} days</p>` : ""}
        ${leg.permitResult.issuingAuthority ? `<p>Authority: ${esc(leg.permitResult.issuingAuthority)}</p>` : ""}
        ${leg.permitResult.conditions ? `<p>Conditions: ${esc(leg.permitResult.conditions)}</p>` : ""}
        ${leg.permitResult.notes ? `<p class="note">${esc(leg.permitResult.notes)}</p>` : ""}
      </div>`;
    }

    // PPR
    if (leg.pprResult?.success) {
      detailsHtml += `<div class="result-box">
        <p class="result-title">PPR — ${esc(leg.pprResult.airportName || leg.pprResult.icao)}</p>
        <p>Required: ${leg.pprResult.pprRequired === "yes" ? "⚠️ Yes" : leg.pprResult.pprRequired === "no" ? "✅ No" : "⚠️ Conditional"}</p>
        ${leg.pprResult.advanceNoticePeriod ? `<p>Notice: ${esc(leg.pprResult.advanceNoticePeriod)}</p>` : ""}
        ${leg.pprResult.contactDetails ? `<p>Contact: ${esc(leg.pprResult.contactDetails)}</p>` : ""}
        ${leg.pprResult.notes ? `<p class="note">${esc(leg.pprResult.notes)}</p>` : ""}
      </div>`;
    }

    // Runway
    if (leg.runwayResult?.found) {
      const rwys = leg.runwayResult.runways.map(r =>
        `<p>${esc(r.ident)} — ${r.lengthFt.toLocaleString()} ft × ${r.widthFt} ft · ${esc(r.surface)}${r.lighted ? " · Lighted" : ""}</p>`
      ).join("");
      detailsHtml += `<div class="result-box">
        <p class="result-title">Runway Data</p>
        ${rwys}
      </div>`;
    }

    // Charges
    if (leg.chargesResult?.success) {
      detailsHtml += `<div class="result-box">
        <p class="result-title">Charges — ${esc(leg.chargesResult.airportName || leg.chargesResult.icao)}</p>
        <table class="charges-table">
          <tr><td>Landing fee</td><td class="amount">$${leg.chargesResult.landingFeeUsd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "—"}</td></tr>
          <tr><td>Parking/day</td><td class="amount">$${leg.chargesResult.parkingPerDayUsd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "—"}</td></tr>
          ${leg.chargesResult.totalParkingUsd != null ? `<tr><td>Parking (${leg.chargesResult.parkingDays}d)</td><td class="amount">$${leg.chargesResult.totalParkingUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>` : ""}
          <tr class="total-row"><td>Total estimate</td><td class="amount">$${leg.chargesResult.totalEstimateUsd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "—"}</td></tr>
        </table>
        ${leg.chargesResult.notes ? `<p class="note">${esc(leg.chargesResult.notes)}</p>` : ""}
      </div>`;
    }

    // Airport Hours & NOTAMs
    if (leg.airportHoursResult?.success) {
      const hrs = leg.airportHoursResult;
      detailsHtml += `<div class="result-box">
        <p class="result-title">Airport Hours & NOTAMs — ${esc(hrs.airportName || hrs.icao)}${hrs.hasLiveNotamData ? ' <span style="font-size:9px;background:#e3f2fd;padding:1px 6px;border-radius:8px;">Live NOTAMs</span>' : ''}</p>
        ${hrs.is24Hours ? '<p style="color:#2e7d32;font-weight:600;">✅ 24-hour operations</p>' : hrs.operatingHoursOpen && hrs.operatingHoursClose ? `<p>Hours: ${esc(hrs.operatingHoursOpen)}–${esc(hrs.operatingHoursClose)} UTC (${esc(hrs.operatingDays || 'Daily')})</p>` : ''}
        ${hrs.curfewStart && hrs.curfewEnd ? `<p style="color:#e65100;">⚠️ Curfew: ${esc(hrs.curfewStart)}–${esc(hrs.curfewEnd)} UTC${hrs.curfewNotes ? ' — ' + esc(hrs.curfewNotes) : ''}</p>` : ''}
        ${hrs.arrivalOutsideHours ? '<p style="color:#c62828;font-weight:600;">❌ Arrival is outside operating hours</p>' : ''}
        ${hrs.departureOutsideHours ? '<p style="color:#c62828;font-weight:600;">❌ Departure is outside operating hours</p>' : ''}
        ${hrs.arrivalDuringCurfew ? '<p style="color:#c62828;font-weight:600;">❌ Arrival falls during curfew</p>' : ''}
        ${hrs.departureDuringCurfew ? '<p style="color:#c62828;font-weight:600;">❌ Departure falls during curfew</p>' : ''}
        ${hrs.activeNotams && hrs.activeNotams.length > 0 ? `
          <p style="font-weight:600;margin-top:6px;">Active NOTAMs (${hrs.activeNotams.length}):</p>
          ${hrs.activeNotams.map(n => `
            <div class="country-row ${n.affectsOperations ? 'country-warn' : 'country-ok'}">
              <p><strong>${n.type === 'closure' ? '🔴' : n.type === 'restriction' ? '🟡' : 'ℹ️'}</strong> ${esc(n.summary)}</p>
              ${n.effectiveFrom || n.effectiveTo ? `<p style="font-size:10px;color:#6b7b8d;">${esc(n.effectiveFrom || '?')} → ${esc(n.effectiveTo || 'UFN')}</p>` : ''}
            </div>
          `).join('')}
        ` : ''}
        ${hrs.seasonalRestrictions ? `<p class="note">Seasonal: ${esc(hrs.seasonalRestrictions)}</p>` : ''}
        ${hrs.notes ? `<p class="note">${esc(hrs.notes)}</p>` : ''}
      </div>`;
    }

    // Feasibility issues & notes
    let feasHtml = "";
    if (feas) {
      if (!feas.feasible) {
        feasHtml += `<div class="feas-block feas-fail">
          <p class="feas-title">⚠ Flight is not feasible based on published information. Contact your service provider to validate information.</p>
          ${feas.issues.map(i => `<p class="issue">✗ ${esc(i)}</p>`).join("")}
        </div>`;
      } else {
        feasHtml += `<div class="feas-block feas-ok"><p class="feas-title">✓ Feasible</p></div>`;
      }
      if (feas.notes.length > 0) {
        feasHtml += feas.notes.map(n => `<p class="note-item">⚠ ${esc(n)}</p>`).join("");
      }
    }

    return `
      <div class="leg">
        <div class="leg-header">
          <span class="leg-num">${idx + 1}</span>
          <span class="leg-icao">${esc(leg.airportIcao) || "—"}</span>
          ${feasBadge}
        </div>
        ${detailsHtml}
        ${feasHtml}
      </div>
    `;
  }

  // Flight info & overflight sections
  let flightAndOverflightHtml = "";
  for (let i = 0; i < legs.length - 1; i++) {
    const fc = flightCalcs?.[i];
    const r = overflightResults[i];

    if (fc) {
      flightAndOverflightHtml += `<div class="result-box" style="background:${!fc.withinRange ? '#fce4ec' : '#f5f7fa'};">
        <p class="result-title">✈ ${esc(legs[i].airportIcao)} → ${esc(legs[i + 1].airportIcao)}</p>
        <p><strong>Distance:</strong> ${fc.distanceNm.toLocaleString()} nm
        ${fc.cruiseSpeedKtas ? ` &nbsp;|&nbsp; <strong>Est. Flight Time:</strong> ${fc.flightTimeFormatted} @ ${fc.cruiseSpeedKtas} KTAS` : ''}
        ${fc.rangeNm != null ? ` &nbsp;|&nbsp; <strong>Range:</strong> ${!fc.withinRange ? '❌ Exceeds' : '✅ Within'} (${fc.rangeNm.toLocaleString()} nm max)` : ''}</p>
      </div>`;
    }

    if (r?.success) {
      flightAndOverflightHtml += `<div class="result-box">
        <p class="result-title">Overflight: ${esc(legs[i].airportIcao)} → ${esc(legs[i + 1].airportIcao)}</p>
        ${r.routeSummary ? `<p>${esc(r.routeSummary)}</p>` : ""}
        ${r.totalPermitsNeeded != null ? `<p>${r.totalPermitsNeeded === 0 ? "✅ No permits required" : `⚠️ ${r.totalPermitsNeeded} permit(s) required`}</p>` : ""}
        ${r.totalOverflightChargesUsd != null ? `<p>Overflight charges: $${r.totalOverflightChargesUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</p>` : ""}
        ${r.countries ? r.countries.map(c => `
          <div class="country-row ${c.overflightPermitRequired === "yes" ? "country-warn" : "country-ok"}">
            <p><strong>${c.overflightPermitRequired === "yes" ? "⚠️" : "✅"} ${esc(c.country)}</strong> — ${c.overflightPermitRequired === "yes" ? "Permit required" : c.overflightPermitRequired === "no" ? "No permit" : "Conditional"}</p>
            ${c.leadTimeDays != null ? `<p>Lead time: ${c.leadTimeDays}d</p>` : ""}
            ${c.overflightChargeUsd != null ? `<p>Charge: ~$${c.overflightChargeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</p>` : ""}
            ${c.notes ? `<p class="note">${esc(c.notes)}</p>` : ""}
          </div>
        `).join("") : ""}
      </div>`;
    }
  }

  // Visa section
  let visaHtml = "";
  const validNats = visaNationalities.filter(n => n);
  const visaEntries = Object.entries(visaResults).filter(([, v]) => v?.success);
  if (visaEntries.length > 0) {
    visaHtml = `<h2>Visa Requirements</h2>`;
    visaHtml += `<p class="detail">Nationalities: ${validNats.join(", ")}</p>`;
    for (const [icao, vr] of visaEntries) {
      visaHtml += `<div class="result-box">
        <p class="result-title">${esc(icao)} — ${esc(vr!.destinationCountry || "Unknown")}</p>
        ${vr!.results?.map(r => `
          <div class="country-row ${r.visaRequired === "yes" ? "country-warn" : "country-ok"}">
            <p><strong>${r.visaRequired === "yes" ? "❌" : r.visaRequired === "no" ? "✅" : "⚠️"} ${esc(r.nationality)}</strong> — ${r.visaRequired === "yes" ? "Visa required" : r.visaRequired === "no" ? "Visa-free" : "Conditional"}</p>
            ${r.visaType ? `<p>Type: ${esc(r.visaType)}</p>` : ""}
            ${r.maxStayDays != null ? `<p>Max stay: ${r.maxStayDays} days</p>` : ""}
            ${r.notes ? `<p class="note">${esc(r.notes)}</p>` : ""}
          </div>
        `).join("") || ""}
      </div>`;
    }
  }

  // Flight & cost summary
  const totalDistanceNm = flightCalcs ? Object.values(flightCalcs).reduce((s, c) => s + c.distanceNm, 0) : 0;
  const totalFlightTimeMin = flightCalcs ? Object.values(flightCalcs).reduce((s, c) => s + c.flightTimeMinutes, 0) : 0;

  let summaryHtml = "";
  if (totalDistanceNm > 0 || totalCharges > 0 || totalOverflightCharges > 0) {
    summaryHtml = `<div class="cost-summary">`;
    if (totalDistanceNm > 0) {
      summaryHtml += `<h3>Flight Summary</h3>
      <table class="charges-table">
        <tr><td>Total distance</td><td class="amount">${totalDistanceNm.toLocaleString()} nm</td></tr>
        ${totalFlightTimeMin > 0 ? `<tr><td>Est. total flight time</td><td class="amount">${Math.floor(totalFlightTimeMin / 60)}h ${totalFlightTimeMin % 60}m</td></tr>` : ''}
      </table>`;
    }
    if (totalCharges > 0 || totalOverflightCharges > 0) {
      summaryHtml += `<h3 style="margin-top:12px;">Trip Cost Summary</h3>
      <table class="charges-table">
        ${totalCharges > 0 ? `<tr><td>Airport charges (${legs.length} leg${legs.length > 1 ? "s" : ""})</td><td class="amount">$${totalCharges.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>` : ""}
        ${totalOverflightCharges > 0 ? `<tr><td>Overflight charges</td><td class="amount">$${totalOverflightCharges.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>` : ""}
        <tr class="total-row"><td><strong>Estimated Total</strong></td><td class="amount"><strong>$${(totalCharges + totalOverflightCharges).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></td></tr>
      </table>`;
    }
    summaryHtml += `</div>`;
  }

  // Pet travel section
  let petHtml = "";
  const petEntries = Object.entries(petResults).filter(([, v]) => v?.success);
  if (petEntries.length > 0 && petTypes.length > 0) {
    petHtml = `<h2>🐾 Pet Travel Requirements</h2>`;
    petHtml += `<p class="detail">Pet types: ${petTypes.join(", ")}</p>`;
    for (const [icao, pr] of petEntries) {
      petHtml += `<div class="result-box">
        <p class="result-title">${esc(icao)} — ${esc(pr!.destinationCountry || "Unknown")}</p>
        ${pr!.results?.map(r => `
          <div class="country-row ${r.importAllowed === "no" ? "country-warn" : "country-ok"}">
            <p><strong>${r.importAllowed === "no" ? "❌" : r.importAllowed === "yes" ? "✅" : "⚠️"} ${esc(r.petType)}</strong> — ${r.importAllowed === "no" ? "Import not allowed" : r.importAllowed === "yes" ? "Import allowed" : "Conditional"}</p>
            ${r.healthCertificate ? `<p>Health Certificate: ${esc(r.healthCertificate)}</p>` : ""}
            ${r.vaccinations ? `<p>Vaccinations: ${esc(r.vaccinations)}</p>` : ""}
            ${r.microchipRequired != null ? `<p>Microchip: ${r.microchipRequired ? "Required" : "Not required"}</p>` : ""}
            ${r.quarantine ? `<p>Quarantine: ${esc(r.quarantine)}</p>` : ""}
            ${r.bloodTests ? `<p>Blood Tests: ${esc(r.bloodTests)}</p>` : ""}
            ${r.importPermit ? `<p>Import Permit: ${esc(r.importPermit)}</p>` : ""}
            ${r.leadTimeDays != null ? `<p>Lead Time: ${r.leadTimeDays} days</p>` : ""}
            ${r.breedRestrictions ? `<p>Breed Restrictions: ${esc(r.breedRestrictions)}</p>` : ""}
            ${r.documentsRequired ? `<p>Documents: ${esc(r.documentsRequired)}</p>` : ""}
            ${r.privateAviationNotes ? `<p><strong>Private Aviation:</strong> ${esc(r.privateAviationNotes)}</p>` : ""}
            ${r.estimatedFeesUsd != null ? `<p>Estimated Fees: ~$${r.estimatedFeesUsd.toLocaleString()} USD</p>` : ""}
            ${r.preparationTimeline ? `<p>Timeline: ${esc(r.preparationTimeline)}</p>` : ""}
            ${r.notes ? `<p class="note">${esc(r.notes)}</p>` : ""}
          </div>
        `).join("") || ""}
        ${pr!.generalNotes ? `<p class="note">${esc(pr!.generalNotes)}</p>` : ""}
      </div>`;
    }
  }

  // Overall status
  let statusBanner = "";
  if (anyChecked) {
    statusBanner = allFeasible
      ? `<div class="banner banner-ok">✓ All Legs Feasible</div>`
      : `<div class="banner banner-fail">✗ Issues Detected — Review leg details below</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Airport Ops Feasibility Report — ${now} UTC</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'IBM Plex Sans', system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.5;
    color: #1a2332;
    padding: 24px 32px;
    max-width: 800px;
    margin: 0 auto;
  }
  
  @media print {
    body { padding: 0; font-size: 10px; }
    .no-print { display: none !important; }
    .leg { break-inside: avoid; }
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 2px solid #1a3a5c;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
  .header h1 { font-size: 18px; font-weight: 600; color: #1a3a5c; }
  .header .meta { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #6b7b8d; }

  .actions { display: flex; gap: 8px; margin-bottom: 20px; }
  .actions button {
    padding: 8px 20px;
    border: 1px solid #1a3a5c;
    background: #1a3a5c;
    color: #fff;
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 12px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
  }
  .actions button:hover { background: #244d73; }
  .actions button.outline { background: #fff; color: #1a3a5c; }
  .actions button.outline:hover { background: #f0f4f8; }

  .config { margin-bottom: 16px; padding: 12px 16px; background: #f5f7fa; border-radius: 8px; }
  .config p { font-size: 12px; }
  .config strong { font-weight: 600; }

  .banner {
    padding: 10px 16px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 16px;
  }
  .banner-ok { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
  .banner-fail { background: #fce4ec; color: #c62828; border: 1px solid #ef9a9a; }

  h2 { font-size: 14px; font-weight: 600; margin: 20px 0 10px; color: #1a3a5c; border-bottom: 1px solid #e0e6ed; padding-bottom: 4px; }

  .leg {
    border: 1px solid #dce3eb;
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 12px;
  }
  .leg-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .leg-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #1a3a5c;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
  }
  .leg-icao { font-weight: 600; font-size: 14px; font-family: 'IBM Plex Mono', monospace; letter-spacing: 2px; }

  .badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
  .badge-ok { background: #e8f5e9; color: #2e7d32; }
  .badge-fail { background: #fce4ec; color: #c62828; }

  .detail { font-size: 11px; color: #4a5568; margin: 4px 0; }

  .result-box {
    background: #f8fafb;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 8px 0;
    font-size: 11px;
  }
  .result-title { font-weight: 600; font-size: 11px; margin-bottom: 4px; color: #1a3a5c; }

  .charges-table { width: 100%; border-collapse: collapse; }
  .charges-table td { padding: 2px 0; }
  .charges-table .amount { text-align: right; font-family: 'IBM Plex Mono', monospace; }
  .charges-table .total-row { border-top: 1px solid #d0d7de; font-weight: 600; }

  .country-row { padding: 4px 8px; margin: 4px 0; border-radius: 4px; }
  .country-warn { background: #fff8e1; border-left: 3px solid #ffa000; }
  .country-ok { background: #e8f5e9; border-left: 3px solid #66bb6a; }

  .note { color: #6b7b8d; font-style: italic; }
  .note-item { color: #e65100; font-size: 10px; margin: 2px 0; }

  .feas-block { padding: 10px 14px; border-radius: 6px; margin: 8px 0; }
  .feas-ok { background: #e8f5e9; border: 1px solid #a5d6a7; }
  .feas-fail { background: #fce4ec; border: 1px solid #ef9a9a; }
  .feas-title { font-weight: 600; font-size: 11px; margin-bottom: 4px; }
  .issue { color: #c62828; font-size: 10px; margin: 2px 0; }

  .cost-summary {
    background: #f0f4f8;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    padding: 14px 16px;
    margin: 16px 0;
  }
  .cost-summary h3 { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #1a3a5c; }

  .footer {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid #e0e6ed;
    font-size: 9px;
    color: #8a9bb0;
    text-align: center;
  }
</style>
</head>
<body>
  <div class="header" style="display:flex;align-items:center;gap:16px;">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="AEG Fuels" style="height:96px;width:auto;" />` : ''}
    <div>
      <h1 style="margin:0;">✈ Airport Ops Feasibility Report</h1>
      <div class="meta">${now} UTC</div>
    </div>
  </div>

  <div class="actions no-print">
    <button onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="outline" onclick="window.close()">Close</button>
  </div>

  <div class="config">
    <p><strong>Aircraft:</strong> ${esc(aircraftType) || "Not specified"} &nbsp;|&nbsp; <strong>Flight Type:</strong> ${esc(flightTypeLabel[flightType] || flightType) || "Not specified"}</p>
    <p><strong>Legs:</strong> ${legs.length} &nbsp;|&nbsp; <strong>Route:</strong> ${legs.map(l => l.airportIcao || "—").join(" → ")}</p>
  </div>

  ${statusBanner}

  <h2>Trip Legs</h2>
  ${legs.map((l, i) => renderLeg(l, i)).join("")}

  ${flightAndOverflightHtml ? `<h2>Flight Routes & Overflight Permits</h2>${flightAndOverflightHtml}` : ""}

  ${visaHtml}

  ${petHtml}

  ${summaryHtml}

  <div class="footer">
    Generated by Airport Ops Feasibility Tool — ${now} UTC<br>
    This report is based on publicly available information. Always verify with your service provider before operations.
  </div>
</body>
</html>`;
}
