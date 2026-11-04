// Preview-only October 2026 correction calculations. No financial writes.
const round = n => Math.round(n * 100) / 100;
function amount(value, name) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(name + ' must be a nonnegative finite number');
  }
  return round(Number(value));
}
export function previewOctoberCorrection(input) {
  if (!input || !input.attendanceId || !input.employeeCode ||
      !/^2026-10-(0[1-9]|[12][0-9]|3[01])$/.test(input.attendanceDate)) {
    throw new Error('October attendance identity required');
  }
  const savedKm = amount(input.savedKm, 'savedKm');
  const savedPetrol = amount(input.savedPetrol, 'savedPetrol');
  const addKm = amount(input.verifiedAddKm, 'verifiedAddKm');
  const removeKm = amount(input.verifiedRemoveKm, 'verifiedRemoveKm');
  const correctedPetrol = amount(input.correctedPetrol, 'correctedPetrol');
  if (addKm === 0 && removeKm === 0) throw new Error('Zero correction');
  if (removeKm > savedKm + addKm) throw new Error('Removal exceeds credited KM');
  if (String(input.reason || '').trim().length < 15 || !Array.isArray(input.evidenceReferences) ||
      input.evidenceReferences.length === 0 || input.evidenceReferences.some(x => String(x).trim().length < 8)) {
    throw new Error('Reason and evidence references required');
  }
  return {
    attendanceId: input.attendanceId,
    employeeCode: input.employeeCode,
    attendanceDate: input.attendanceDate,
    savedKm, savedPetrol, verifiedAddKm: addKm, verifiedRemoveKm: removeKm,
    correctedKm: round(savedKm + addKm - removeKm),
    correctedPetrol, petrolDelta: round(correctedPetrol - savedPetrol),
    reason: input.reason.trim(), evidenceReferences: [...input.evidenceReferences],
    status: 'PREVIEW_ONLY_NOT_POSTED'
  };
}
