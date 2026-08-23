/**
 * Staff, the shift roster, and who actually turned up.
 *
 * Three separate things that are easy to confuse:
 *
 *   staff       — a person who works at the cafe. Not the same as a login: the
 *                 kitchen porter has no reason to sign into the till, and a
 *                 manager who leaves should lose their login without erasing
 *                 the hours they worked last month.
 *   shifts      — the roster. What someone is *meant* to work. Freely editable.
 *   attendance  — what happened. Clock-in and clock-out times, one record per
 *                 person per day, correctable by an admin because a till in a
 *                 cafe gets forgotten at the end of a rush.
 *
 * Hours are whole minutes, and a shift that runs past midnight is handled
 * everywhere rather than producing a negative day.
 */

import { STORES, getAll, getByKey, put, remove, putMany, clearStore } from '../db/database.js';
import { requireAdmin, requireSignedIn, getSession } from '../core/session.js';
import { AppError, uid, toDateKey, pad } from '../core/utils.js';
import { ATTENDANCE_STATUS } from '../config/app.config.js';

/* ---------------------------------------------------------------- time --- */

/** "09:30" → 570 minutes past midnight. Null if it is not a time. */
export function parseTimeOfDay(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 570 → "09:30". */
export function formatTimeOfDay(minutes) {
  const value = ((Math.round(Number(minutes) || 0) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

/** 570 → "9h 30m", for hour totals rather than clock times. */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * Minutes from one clock time to another. A finish earlier than the start means
 * the shift crossed midnight — the late shift is a real shift, not a negative
 * one.
 */
export function minutesBetween(startText, endText) {
  const start = parseTimeOfDay(startText);
  const end = parseTimeOfDay(endText);
  if (start === null || end === null) return 0;
  return end >= start ? end - start : 1440 - start + end;
}

/** Rostered minutes for a shift, less its unpaid break. */
export function shiftMinutes(shift) {
  return Math.max(0, minutesBetween(shift.start, shift.end) - (Number(shift.breakMinutes) || 0));
}

/** Minutes actually worked, from a clock-in/clock-out pair. */
export function attendanceMinutes(record) {
  if (!record?.clockIn || !record?.clockOut) return 0;
  const worked = (new Date(record.clockOut) - new Date(record.clockIn)) / 60000;
  if (!Number.isFinite(worked) || worked <= 0) return 0;
  return Math.max(0, Math.round(worked) - (Number(record.breakMinutes) || 0));
}

/* --------------------------------------------------------------- staff --- */

let cache = null;
const listeners = new Set();

export function onStaffChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function announce() {
  listeners.forEach((fn) => fn(cache));
}

function sortStaff(rows) {
  return rows.sort(
    (a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name, 'en')
  );
}

export async function loadStaff() {
  cache = sortStaff(await getAll(STORES.STAFF));
  return cache;
}

export function getStaff({ activeOnly = false } = {}) {
  const rows = cache || [];
  return activeOnly ? rows.filter((row) => row.active !== false) : rows;
}

export function getStaffMember(id) {
  return getStaff().find((row) => row.id === id) || null;
}

/** The staff record linked to a login, if there is one. */
export function staffForUsername(username) {
  const key = String(username || '').toLowerCase();
  return getStaff().find((row) => String(row.username || '').toLowerCase() === key) || null;
}

export async function createStaff(draft) {
  requireAdmin('adding staff');
  const name = String(draft.name || '').trim();
  if (!name) throw new AppError('Give the staff member a name.', 'VALIDATION');
  if (name.length > 60) throw new AppError('Staff names are limited to 60 characters.', 'VALIDATION');

  const now = new Date().toISOString();
  const member = {
    id: uid('stf'),
    name,
    jobTitle: String(draft.jobTitle || '').trim() || 'Team member',
    phone: String(draft.phone || '').trim(),
    username: String(draft.username || '').trim().toLowerCase(),
    hourlyRate: Math.max(0, Math.round(Number(draft.hourlyRate) || 0)),
    active: draft.active !== false,
    joinedAt: draft.joinedAt || toDateKey(),
    createdAt: now,
    updatedAt: now,
  };

  await put(STORES.STAFF, member);
  cache = sortStaff([...getStaff(), member]);
  announce();
  return member;
}

export async function updateStaff(id, patch) {
  requireAdmin('editing staff');
  const existing = await getByKey(STORES.STAFF, id);
  if (!existing) throw new AppError('That staff member no longer exists.', 'NOT_FOUND');

  const name = String(patch.name ?? existing.name).trim();
  if (!name) throw new AppError('Give the staff member a name.', 'VALIDATION');

  const member = {
    ...existing,
    ...patch,
    name,
    jobTitle: String(patch.jobTitle ?? existing.jobTitle).trim() || 'Team member',
    phone: String(patch.phone ?? existing.phone).trim(),
    username: String(patch.username ?? existing.username).trim().toLowerCase(),
    hourlyRate: Math.max(0, Math.round(Number(patch.hourlyRate ?? existing.hourlyRate) || 0)),
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.STAFF, member);
  cache = sortStaff(getStaff().map((row) => (row.id === id ? member : row)));
  announce();
  return member;
}

/**
 * Remove someone from the team. Their shifts and attendance stay: a payroll
 * question about last month should still have an answer.
 */
export async function deleteStaff(id) {
  requireAdmin('removing staff');
  await remove(STORES.STAFF, id);
  cache = getStaff().filter((row) => row.id !== id);
  announce();
  return true;
}

/* -------------------------------------------------------------- shifts --- */

export function listShifts() {
  return getAll(STORES.SHIFTS);
}

export async function shiftsBetween(fromKey, toKey) {
  const rows = await getAll(STORES.SHIFTS);
  return rows
    .filter((row) => row.date >= fromKey && row.date <= toKey)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.start).localeCompare(String(b.start)));
}

export async function shiftsOn(dateKey) {
  return shiftsBetween(dateKey, dateKey);
}

function validateShift(draft) {
  if (!draft.staffId) throw new AppError('Choose who the shift is for.', 'VALIDATION');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.date || ''))) {
    throw new AppError('Choose a date for the shift.', 'VALIDATION');
  }
  if (parseTimeOfDay(draft.start) === null || parseTimeOfDay(draft.end) === null) {
    throw new AppError('Enter shift times as HH:MM, for example 09:00.', 'VALIDATION');
  }
  if (minutesBetween(draft.start, draft.end) === 0) {
    throw new AppError('A shift needs to start and finish at different times.', 'VALIDATION');
  }
  const breakMinutes = Math.max(0, Math.round(Number(draft.breakMinutes) || 0));
  if (breakMinutes >= minutesBetween(draft.start, draft.end)) {
    throw new AppError('The break is longer than the shift itself.', 'VALIDATION');
  }
  return { breakMinutes };
}

export async function saveShift(draft) {
  requireAdmin('editing the rota');
  const { breakMinutes } = validateShift(draft);
  const now = new Date().toISOString();

  const shift = {
    id: draft.id || uid('shf'),
    staffId: draft.staffId,
    date: draft.date,
    start: formatTimeOfDay(parseTimeOfDay(draft.start)),
    end: formatTimeOfDay(parseTimeOfDay(draft.end)),
    breakMinutes,
    note: String(draft.note || '').slice(0, 120),
    createdAt: draft.createdAt || now,
    updatedAt: now,
  };

  await put(STORES.SHIFTS, shift);
  return shift;
}

export async function deleteShift(id) {
  requireAdmin('removing a shift');
  await remove(STORES.SHIFTS, id);
  return true;
}

/** Copy one day's roster onto another date — how a week is usually built. */
export async function copyShifts(fromKey, toKey) {
  requireAdmin('copying the rota');
  const source = await shiftsOn(fromKey);
  if (!source.length) {
    throw new AppError(`There are no shifts on ${fromKey} to copy.`, 'NOT_FOUND');
  }

  const now = new Date().toISOString();
  const copies = source.map((shift) => ({
    ...shift,
    id: uid('shf'),
    date: toKey,
    createdAt: now,
    updatedAt: now,
  }));
  await putMany(STORES.SHIFTS, copies);
  return copies.length;
}

/* ---------------------------------------------------------- attendance --- */

/**
 * One record per person per day, so an id can be derived rather than searched
 * for. Clocking in twice updates the same row instead of creating a second one.
 */
function attendanceId(staffId, dateKey) {
  return `att_${dateKey}_${staffId}`;
}

export function listAttendance() {
  return getAll(STORES.ATTENDANCE);
}

export async function attendanceBetween(fromKey, toKey) {
  const rows = await getAll(STORES.ATTENDANCE);
  return rows
    .filter((row) => row.date >= fromKey && row.date <= toKey)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function attendanceOn(dateKey) {
  return attendanceBetween(dateKey, dateKey);
}

export function getAttendance(staffId, dateKey) {
  return getByKey(STORES.ATTENDANCE, attendanceId(staffId, dateKey));
}

/** Start someone's day. Clocking in again keeps the original arrival time. */
export async function clockIn(staffId, dateKey = toDateKey()) {
  requireSignedIn();
  const member = getStaffMember(staffId);
  if (!member) throw new AppError('That staff member no longer exists.', 'NOT_FOUND');
  if (member.active === false) throw new AppError(`${member.name} is not an active member of staff.`, 'INACTIVE');

  const existing = await getAttendance(staffId, dateKey);
  if (existing?.clockIn && !existing.clockOut) {
    throw new AppError(`${member.name} is already clocked in.`, 'ALREADY_IN');
  }

  const now = new Date().toISOString();
  const record = {
    id: attendanceId(staffId, dateKey),
    staffId,
    date: dateKey,
    status: ATTENDANCE_STATUS.PRESENT,
    clockIn: existing?.clockIn || now,
    clockOut: null,
    breakMinutes: existing?.breakMinutes ?? 0,
    note: existing?.note || '',
    source: 'CLOCK',
    recordedBy: getSession()?.username || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await put(STORES.ATTENDANCE, record);
  return record;
}

export async function clockOut(staffId, dateKey = toDateKey()) {
  requireSignedIn();
  const existing = await getAttendance(staffId, dateKey);
  if (!existing?.clockIn) {
    throw new AppError('There is no clock-in to close for today.', 'NOT_IN');
  }
  if (existing.clockOut) throw new AppError('That day is already clocked out.', 'ALREADY_OUT');

  const record = {
    ...existing,
    clockOut: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.ATTENDANCE, record);
  return record;
}

/**
 * Admin correction. Times come in as HH:MM against the record's own date, which
 * is what someone typing "she actually left at 18:30" means.
 */
export async function saveAttendance(draft) {
  requireAdmin('editing attendance');
  const { staffId, date } = draft;
  if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new AppError('Choose a staff member and a date.', 'VALIDATION');
  }
  if (!Object.values(ATTENDANCE_STATUS).includes(draft.status)) {
    throw new AppError('Choose whether they were present, absent or on leave.', 'VALIDATION');
  }

  const existing = await getAttendance(staffId, date);
  const now = new Date().toISOString();

  let clockIn = null;
  let clockOut = null;

  if (draft.status === ATTENDANCE_STATUS.PRESENT) {
    const inMinutes = parseTimeOfDay(draft.clockIn);
    if (inMinutes === null) {
      throw new AppError('Enter a start time as HH:MM, for example 09:00.', 'VALIDATION');
    }
    clockIn = dateAtMinutes(date, inMinutes).toISOString();

    if (String(draft.clockOut || '').trim()) {
      const outMinutes = parseTimeOfDay(draft.clockOut);
      if (outMinutes === null) {
        throw new AppError('Enter a finish time as HH:MM, or leave it blank.', 'VALIDATION');
      }
      // A finish before the start belongs to the next morning.
      const finish = dateAtMinutes(date, outMinutes);
      if (outMinutes <= inMinutes) finish.setDate(finish.getDate() + 1);
      clockOut = finish.toISOString();
    }
  }

  const breakMinutes = Math.max(0, Math.round(Number(draft.breakMinutes) || 0));
  const record = {
    id: attendanceId(staffId, date),
    staffId,
    date,
    status: draft.status,
    clockIn,
    clockOut,
    breakMinutes,
    note: String(draft.note || '').slice(0, 160),
    source: 'MANUAL',
    recordedBy: getSession()?.username || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (record.clockIn && record.clockOut && attendanceMinutes(record) <= 0) {
    throw new AppError('The break is as long as the time worked. Check the times.', 'VALIDATION');
  }

  await put(STORES.ATTENDANCE, record);
  return record;
}

function dateAtMinutes(dateKey, minutes) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

export async function deleteAttendance(staffId, dateKey) {
  requireAdmin('removing an attendance record');
  await remove(STORES.ATTENDANCE, attendanceId(staffId, dateKey));
  return true;
}

/* ------------------------------------------------------------ summary --- */

/**
 * Hours and pay per person over a date range.
 *
 * @returns {{staffId:string, name:string, days:number, minutes:number,
 *            rosteredMinutes:number, pay:number}[]}
 */
export function summariseHours(staffList, attendance, shifts, { from, to }) {
  const inRange = (row) => row.date >= from && row.date <= to;
  const attendanceRows = attendance.filter(inRange);
  const shiftRows = shifts.filter(inRange);

  return staffList.map((member) => {
    const mine = attendanceRows.filter((row) => row.staffId === member.id);
    const minutes = mine.reduce((total, row) => total + attendanceMinutes(row), 0);
    const rostered = shiftRows
      .filter((row) => row.staffId === member.id)
      .reduce((total, row) => total + shiftMinutes(row), 0);

    return {
      staffId: member.id,
      name: member.name,
      jobTitle: member.jobTitle,
      days: mine.filter((row) => row.status === ATTENDANCE_STATUS.PRESENT).length,
      absent: mine.filter((row) => row.status === ATTENDANCE_STATUS.ABSENT).length,
      leave: mine.filter((row) => row.status === ATTENDANCE_STATUS.LEAVE).length,
      minutes,
      rosteredMinutes: rostered,
      // Hourly rate is paise per hour; minutes are exact, so round once at the end.
      pay: Math.round((minutes / 60) * (member.hourlyRate || 0)),
    };
  });
}

/** Who is on the clock right now. */
export function onDuty(attendance) {
  return attendance.filter((row) => row.clockIn && !row.clockOut);
}

/* ------------------------------------------------------ backup support --- */

export async function replaceAll(staffRows, shifts, attendance) {
  await clearStore(STORES.STAFF);
  if (staffRows?.length) await putMany(STORES.STAFF, staffRows);

  await clearStore(STORES.SHIFTS);
  if (shifts?.length) await putMany(STORES.SHIFTS, shifts);

  await clearStore(STORES.ATTENDANCE);
  if (attendance?.length) await putMany(STORES.ATTENDANCE, attendance);

  await loadStaff();
  announce();
}
