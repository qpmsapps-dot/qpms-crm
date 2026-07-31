import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publicPage = await readFile(new URL('../src/pages/PublicFeedbackQrPage.jsx', import.meta.url), 'utf8');
const generatorPage = await readFile(new URL('../src/pages/HospitalFeedbackQrGenerator.jsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8');

test('Hospital Feedback QR public flow starts at language selection and remains local-only', () => {
  assert.ok(publicPage.includes('Welcome!'));
  assert.ok(publicPage.includes('\u0bb5\u0bb0\u0bb5\u0bc7\u0bb1\u0bcd\u0b95\u0bbf\u0bb1\u0bcb\u0bae\u0bcd!'));
  assert.ok(publicPage.includes("setCurrentStep('language')"));
  assert.ok(publicPage.includes("setCurrentStep('location')"));
  assert.ok(publicPage.includes("setCurrentStep('rating')"));
  assert.ok(publicPage.includes("setCurrentStep('thankYou')"));
  assert.ok(publicPage.includes("setCurrentStep('complete')"));
  assert.ok(publicPage.includes("sessionStorage.setItem(languageStorageKey, nextLanguage)"));
  assert.ok(publicPage.includes("hospital-feedback-qr:${token || 'missing'}:language"));
  assert.ok(publicPage.includes('verifyPublicHospitalFeedbackSession'));
  assert.doesNotMatch(publicPage, /createHospitalTicket|createTicket|ticket_number|ticketNumber|feedbackApi|api\.post|publicApi\.post/);
  assert.doesNotMatch(api, /submitHospitalFeedback|createHospitalFeedback|createHospitalTicketFromFeedback/);
});

test('Hospital Feedback QR public flow has English and Tamil location, rating and completion copy', () => {
  assert.ok(publicPage.includes('Location identified successfully.'));
  assert.ok(publicPage.includes('\u0b87\u0b9f\u0bae\u0bcd \u0bb5\u0bc6\u0bb1\u0bcd\u0bb1\u0bbf\u0b95\u0bb0\u0bae\u0bbe\u0b95 \u0b95\u0ba3\u0bcd\u0b9f\u0bb1\u0bbf\u0baf\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0ba4\u0bc1.'));
  assert.ok(publicPage.includes('How was your experience?'));
  assert.ok(publicPage.includes('\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b85\u0ba9\u0bc1\u0baa\u0bb5\u0bae\u0bcd \u0b8e\u0baa\u0bcd\u0baa\u0b9f\u0bbf \u0b87\u0bb0\u0bc1\u0ba8\u0bcd\u0ba4\u0ba4\u0bc1?'));
  assert.ok(publicPage.includes('Please select one rating to continue.'));
  assert.ok(publicPage.includes('Submit Feedback'));
  assert.ok(publicPage.includes('Thank you!'));
  assert.ok(publicPage.includes('\u0ba8\u0ba9\u0bcd\u0bb1\u0bbf!'));
  assert.ok(publicPage.includes('\u0bae\u0bbf\u0b95\u0bb5\u0bc1\u0bae\u0bcd \u0bae\u0bcb\u0b9a\u0bae\u0bcd'));
});

test('Hospital Feedback QR public page keeps safe error and location rendering contracts', () => {
  assert.ok(publicPage.includes('Invalid QR Code'));
  assert.ok(publicPage.includes('\u0ba4\u0bb5\u0bb1\u0bbe\u0ba9 QR \u0b95\u0bc1\u0bb1\u0bbf\u0baf\u0bc0\u0b9f\u0bc1'));
  assert.ok(publicPage.includes('Session expired'));
  assert.ok(publicPage.includes('\u0b85\u0bae\u0bb0\u0bcd\u0bb5\u0bc1 \u0b95\u0bbe\u0bb2\u0bbe\u0bb5\u0ba4\u0bbf\u0baf\u0bbe\u0ba9\u0ba4\u0bc1'));
  assert.ok(publicPage.includes('onRetry={loadQr}'));
  assert.ok(publicPage.includes('[t.department, location.departmentName]'));
  assert.ok(publicPage.includes('.filter(([, value]) => Boolean(value))'));
  assert.doesNotMatch(publicPage, /hospitalId|blockId|floorId|locationId|employee|supervisor|ticketConfig/);
});

test('Hospital Feedback QR generator preview and download share one PNG data URL', () => {
  assert.ok(generatorPage.includes('<img src={qr.qr_png_data_url}'));
  assert.ok(generatorPage.includes('link.href = qr.qr_png_data_url'));
  assert.ok(generatorPage.includes('Active'));
  assert.ok(generatorPage.includes('Hospital'));
  assert.ok(generatorPage.includes('Block'));
  assert.ok(generatorPage.includes('Floor'));
  assert.ok(generatorPage.includes('Location'));
});
