/**
 * Staff: who is in today, who is on next week, and how many hours that came to.
 *
 * The rota is a week grid because that is how a cafe rota is drawn on the wall.
 * Every shift in it is editable, a day can be copied onto another day, and
 * attendance can be corrected after the fact — which matters, because the one
 * certainty about clocking out is that somebody will forget.
 */

import {
  el,
  clear,
  append,
  toDateKey,
  fromDateKey,
  formatDate,
  formatTime,
  pad,
} from '../core/utils.js';
import { formatMoney, parseRupeesToPaise, formatAmount } from '../core/money.js';
import { ATTENDANCE_STATUS, ATTENDANCE_LABELS } from '../config/app.config.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as staffRepo from '../repositories/staff.repo.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The Monday on or before a date — rotas are read Monday to Sunday. */
function weekStart(dateKey) {
  const date = fromDateKey(dateKey);
  const weekday = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - weekday);
  return toDateKey(date);
}

function addDays(dateKey, days) {
  const date = fromDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function weekDays(startKey) {
  return Array.from({ length: 7 }, (_, index) => addDays(startKey, index));
}

export async function renderStaff({ outlet }) {
  const settings = getSettings();
  const symbol = settings.currencySymbol || '₹';
  const today = toDateKey();

  const state = { week: weekStart(today) };

  await staffRepo.loadStaff();

  const todayPanel = el('div.stack');
  const rotaPanel = el('div.stack');
  const hoursPanel = el('div.stack');
  const peoplePanel = el('div.stack');
  const weekLabel = el('span.rota__weeklabel');

  /* --------------------------------------------------------- people --- */

  function personForm(member = null) {
    const name = el('input.input', { type: 'text', value: member?.name || '', maxlength: 60 });
    const jobTitle = el('input.input', {
      type: 'text',
      value: member?.jobTitle || '',
      placeholder: 'Barista, Kitchen, Manager…',
    });
    const phone = el('input.input', { type: 'tel', value: member?.phone || '' });
    const hourlyRate = el('input.input', {
      type: 'text',
      inputmode: 'decimal',
      value: member?.hourlyRate ? formatAmount(member.hourlyRate) : '',
      placeholder: '0.00',
    });
    const username = el('input.input', {
      type: 'text',
      value: member?.username || '',
      placeholder: 'Their till login, if they have one',
      autocapitalize: 'none',
      spellcheck: false,
    });
    const active = el('input', { type: 'checkbox', checked: member ? member.active !== false : true });

    const modal = openModal({
      title: member ? `Edit ${member.name}` : 'Add a member of staff',
      body: el('div.formgrid', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Name' }), name]),
        el('label.field', {}, [el('span.field__label', { text: 'Job' }), jobTitle]),
        el('label.field', {}, [el('span.field__label', { text: 'Phone' }), phone]),
        el('label.field', {}, [
          el('span.field__label', { text: `Hourly rate (${symbol})` }),
          hourlyRate,
          el('span.hint', { text: 'Used to total pay on the Hours tab. Leave blank to skip it.' }),
        ]),
        el('label.field', {}, [
          el('span.field__label', { text: 'Till username' }),
          username,
          el('span.hint', { text: 'Links this person to a login. Not everyone needs one.' }),
        ]),
        el('label.field.field--check', {}, [
          active,
          el('span', {}, [
            el('span', { text: 'Currently working here' }),
            el('span.hint', { text: 'Turning this off keeps their past hours and rota.' }),
          ]),
        ]),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: member ? 'Save' : 'Add',
          onclick: async (event) => {
            const rate = parseRupeesToPaise(hourlyRate.value || '0');
            if (rate === null) {
              toast.error('Enter an hourly rate like 150 or 150.50, or leave it blank.');
              return;
            }
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const draft = {
                name: name.value,
                jobTitle: jobTitle.value,
                phone: phone.value,
                hourlyRate: rate,
                username: username.value,
                active: active.checked,
              };
              if (member) await staffRepo.updateStaff(member.id, draft);
              else await staffRepo.createStaff(draft);

              toast.success(member ? 'Staff member saved.' : 'Staff member added.');
              modal.close();
              await paintAll();
            } catch (error) {
              reportError(error);
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  function paintPeople() {
    const people = staffRepo.getStaff();
    clear(peoplePanel);

    if (!people.length) {
      peoplePanel.appendChild(
        el('div.empty', {}, [
          el('p', { text: 'No staff yet. Add your team to build a rota and track attendance.' }),
          el('button.btn.btn--primary.btn--sm', {
            type: 'button',
            text: 'Add a member of staff',
            onclick: () => personForm(),
          }),
        ])
      );
      return;
    }

    peoplePanel.appendChild(
      el('div.table', {}, [
        el('div.table__head.table__head--people', {}, [
          el('span', { text: 'Name' }),
          el('span', { text: 'Job' }),
          el('span', { text: 'Phone' }),
          el('span.table__num', { text: 'Rate' }),
          el('span', { text: '' }),
        ]),
        ...people.map((member) =>
          el('div.table__row.table__row--people', { class: member.active === false ? 'is-muted' : '' }, [
            el('span', {}, [
              el('strong', { text: member.name }),
              member.active === false ? el('span.hint', { text: 'No longer working here' }) : null,
            ]),
            el('span', { text: member.jobTitle || '—' }),
            el('span', { text: member.phone || '—' }),
            el('span.table__num', {
              text: member.hourlyRate ? `${formatMoney(member.hourlyRate, symbol)}/h` : '—',
            }),
            el('span.table__actions', {}, [
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Edit',
                onclick: () => personForm(member),
              }),
              el('button.icon-btn.icon-btn--danger', {
                type: 'button',
                text: '×',
                'aria-label': `Remove ${member.name}`,
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: `Remove ${member.name}?`,
                    message:
                      'Their hours and rota stay in the records, so past payroll still adds up. To simply stop rostering them, edit them and untick "currently working here" instead.',
                    confirmLabel: 'Remove',
                    tone: 'danger',
                  });
                  if (!ok) return;
                  try {
                    await staffRepo.deleteStaff(member.id);
                    toast.success('Staff member removed.');
                    await paintAll();
                  } catch (error) {
                    reportError(error);
                  }
                },
              }),
            ]),
          ])
        ),
      ])
    );
  }

  /* ---------------------------------------------------------- today --- */

  async function paintToday() {
    const people = staffRepo.getStaff({ activeOnly: true });
    const [attendance, shifts] = await Promise.all([
      staffRepo.attendanceOn(today),
      staffRepo.shiftsOn(today),
    ]);
    const byStaff = new Map(attendance.map((row) => [row.staffId, row]));

    clear(todayPanel);
    if (!people.length) {
      todayPanel.appendChild(el('p.empty', { text: 'Add your team below to start tracking attendance.' }));
      return;
    }

    todayPanel.appendChild(
      el(
        'div.roster',
        {},
        people.map((member) => {
          const record = byStaff.get(member.id);
          const rostered = shifts.filter((shift) => shift.staffId === member.id);
          const onClock = record?.clockIn && !record.clockOut;
          const worked = staffRepo.attendanceMinutes(record);

          return el('article.roster__card', { class: onClock ? 'is-on' : '' }, [
            el('div.roster__who', {}, [
              el('h3.roster__name', { text: member.name }),
              el('span.roster__job', { text: member.jobTitle || 'Team member' }),
            ]),

            el('div.roster__state', {}, [
              rostered.length
                ? el('span.roster__shift', {
                    text: rostered.map((shift) => `${shift.start}–${shift.end}`).join(', '),
                  })
                : el('span.roster__shift.is-muted', { text: 'Not on the rota today' }),
              record
                ? el('span.roster__times', {
                    text:
                      record.status !== ATTENDANCE_STATUS.PRESENT
                        ? ATTENDANCE_LABELS[record.status]
                        : `In ${formatTime(record.clockIn)}${
                            record.clockOut ? ` · Out ${formatTime(record.clockOut)}` : ' · still in'
                          }${worked ? ` · ${staffRepo.formatDuration(worked)}` : ''}`,
                  })
                : el('span.roster__times.is-muted', { text: 'Not clocked in' }),
            ]),

            el('div.roster__actions', {}, [
              onClock
                ? el('button.btn.btn--primary.btn--sm', {
                    type: 'button',
                    text: 'Clock out',
                    onclick: async () => {
                      try {
                        await staffRepo.clockOut(member.id, today);
                        toast.success(`${member.name} clocked out.`);
                        await paintToday();
                        await paintHours();
                      } catch (error) {
                        reportError(error);
                      }
                    },
                  })
                : el('button.btn.btn--ghost.btn--sm', {
                    type: 'button',
                    text: record?.clockOut ? 'Clocked out' : 'Clock in',
                    disabled: Boolean(record?.clockOut),
                    onclick: async () => {
                      try {
                        await staffRepo.clockIn(member.id, today);
                        toast.success(`${member.name} clocked in.`);
                        await paintToday();
                      } catch (error) {
                        reportError(error);
                      }
                    },
                  }),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Edit',
                onclick: () => attendanceForm(member, today, record),
              }),
            ]),
          ]);
        })
      )
    );
  }

  function attendanceForm(member, dateKey, record) {
    const status = el(
      'select.input',
      {},
      Object.values(ATTENDANCE_STATUS).map((value) =>
        el('option', { value, text: ATTENDANCE_LABELS[value] })
      )
    );
    status.value = record?.status || ATTENDANCE_STATUS.PRESENT;

    const clockIn = el('input.input', {
      type: 'time',
      value: record?.clockIn ? timeValue(record.clockIn) : settings.defaultShiftStart || '09:00',
    });
    const clockOut = el('input.input', {
      type: 'time',
      value: record?.clockOut ? timeValue(record.clockOut) : '',
    });
    const breakMinutes = el('input.input', {
      type: 'text',
      inputmode: 'numeric',
      value: String(record?.breakMinutes ?? settings.defaultBreakMinutes ?? 0),
    });
    const note = el('input.input', { type: 'text', value: record?.note || '', maxlength: 160 });

    const timesBlock = el('div.formgrid', {}, [
      el('label.field', {}, [el('span.field__label', { text: 'Started' }), clockIn]),
      el('label.field', {}, [
        el('span.field__label', { text: 'Finished' }),
        clockOut,
        el('span.hint', { text: 'Leave blank if they are still working.' }),
      ]),
      el('label.field', {}, [
        el('span.field__label', { text: 'Unpaid break (minutes)' }),
        breakMinutes,
      ]),
    ]);

    const syncVisibility = () => {
      timesBlock.hidden = status.value !== ATTENDANCE_STATUS.PRESENT;
    };
    status.addEventListener('change', syncVisibility);
    syncVisibility();

    const modal = openModal({
      title: `${member.name} · ${formatDate(fromDateKey(dateKey))}`,
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Attendance' }), status]),
        timesBlock,
        el('label.field', {}, [el('span.field__label', { text: 'Note' }), note]),
      ]),
      actions: [
        record
          ? el('button.btn.btn--ghost', {
              type: 'button',
              text: 'Clear the day',
              onclick: async () => {
                try {
                  await staffRepo.deleteAttendance(member.id, dateKey);
                  toast.success('Attendance cleared.');
                  modal.close();
                  await paintToday();
                  await paintHours();
                } catch (error) {
                  reportError(error);
                }
              },
            })
          : null,
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Save',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              await staffRepo.saveAttendance({
                staffId: member.id,
                date: dateKey,
                status: status.value,
                clockIn: clockIn.value,
                clockOut: clockOut.value,
                breakMinutes: Number(breakMinutes.value) || 0,
                note: note.value,
              });
              toast.success('Attendance saved.');
              modal.close();
              await paintToday();
              await paintHours();
            } catch (error) {
              reportError(error);
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  /** An ISO timestamp as the HH:MM a time input expects. */
  function timeValue(iso) {
    const date = new Date(iso);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /* ----------------------------------------------------------- rota --- */

  function shiftForm(member, dateKey, shift = null) {
    const staffSelect = el(
      'select.input',
      {},
      staffRepo
        .getStaff({ activeOnly: true })
        .map((person) => el('option', { value: person.id, text: person.name }))
    );
    staffSelect.value = shift?.staffId || member?.id || '';

    const date = el('input.input', { type: 'date', value: shift?.date || dateKey });
    const start = el('input.input', {
      type: 'time',
      value: shift?.start || settings.defaultShiftStart || '09:00',
    });
    const end = el('input.input', {
      type: 'time',
      value: shift?.end || settings.defaultShiftEnd || '17:00',
    });
    const breakMinutes = el('input.input', {
      type: 'text',
      inputmode: 'numeric',
      value: String(shift?.breakMinutes ?? settings.defaultBreakMinutes ?? 0),
    });
    const note = el('input.input', { type: 'text', value: shift?.note || '', maxlength: 120 });

    const modal = openModal({
      title: shift ? 'Edit shift' : 'Add a shift',
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Who' }), staffSelect]),
        el('label.field', {}, [el('span.field__label', { text: 'Date' }), date]),
        el('div.formgrid', {}, [
          el('label.field', {}, [el('span.field__label', { text: 'From' }), start]),
          el('label.field', {}, [el('span.field__label', { text: 'To' }), end]),
        ]),
        el('label.field', {}, [
          el('span.field__label', { text: 'Unpaid break (minutes)' }),
          breakMinutes,
        ]),
        el('label.field', {}, [el('span.field__label', { text: 'Note' }), note]),
        el('p.hint', { text: 'A finish time before the start means the shift runs past midnight.' }),
      ]),
      actions: [
        shift
          ? el('button.btn.btn--ghost', {
              type: 'button',
              text: 'Delete shift',
              onclick: async () => {
                try {
                  await staffRepo.deleteShift(shift.id);
                  toast.success('Shift removed.');
                  modal.close();
                  await paintRota();
                  await paintHours();
                } catch (error) {
                  reportError(error);
                }
              },
            })
          : null,
        el('button.btn.btn--primary', {
          type: 'button',
          text: shift ? 'Save shift' : 'Add shift',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              await staffRepo.saveShift({
                id: shift?.id,
                createdAt: shift?.createdAt,
                staffId: staffSelect.value,
                date: date.value,
                start: start.value,
                end: end.value,
                breakMinutes: Number(breakMinutes.value) || 0,
                note: note.value,
              });
              toast.success('Rota updated.');
              modal.close();
              await paintRota();
              await paintHours();
            } catch (error) {
              reportError(error);
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  async function paintRota() {
    const days = weekDays(state.week);
    const people = staffRepo.getStaff({ activeOnly: true });
    const shifts = await staffRepo.shiftsBetween(days[0], days[6]);

    weekLabel.textContent = `${formatDate(fromDateKey(days[0]))} — ${formatDate(fromDateKey(days[6]))}`;

    clear(rotaPanel);
    if (!people.length) {
      rotaPanel.appendChild(el('p.empty', { text: 'Add your team below to build a rota.' }));
      return;
    }

    const header = el('div.rota__row.rota__row--head', {}, [
      el('span.rota__name', { text: 'Staff' }),
      ...days.map((day, index) =>
        el('span.rota__day', { class: day === today ? 'is-today' : '' }, [
          el('span.rota__dayname', { text: DAY_NAMES[index] }),
          el('span.rota__daydate', { text: String(fromDateKey(day).getDate()) }),
        ])
      ),
      el('span.rota__total', { text: 'Hours' }),
    ]);

    const rows = people.map((member) => {
      const mine = shifts.filter((shift) => shift.staffId === member.id);
      const total = mine.reduce((sum, shift) => sum + staffRepo.shiftMinutes(shift), 0);

      return el('div.rota__row', {}, [
        el('span.rota__name', {}, [
          el('strong', { text: member.name }),
          el('span.hint', { text: member.jobTitle || '' }),
        ]),
        ...days.map((day) => {
          const cellShifts = mine.filter((shift) => shift.date === day);
          return el('div.rota__cell', { class: day === today ? 'is-today' : '' }, [
            ...cellShifts.map((shift) =>
              el('button.rota__shift', {
                type: 'button',
                title: `${shift.start}–${shift.end}${shift.note ? ` · ${shift.note}` : ''}`,
                onclick: () => shiftForm(member, day, shift),
                text: `${shift.start}–${shift.end}`,
              })
            ),
            el('button.rota__add', {
              type: 'button',
              text: '+',
              'aria-label': `Add a shift for ${member.name} on ${day}`,
              onclick: () => shiftForm(member, day),
            }),
          ]);
        }),
        el('span.rota__total', { text: staffRepo.formatDuration(total) }),
      ]);
    });

    rotaPanel.appendChild(el('div.rota', {}, [header, ...rows]));
  }

  function copyDayForm() {
    const days = weekDays(state.week);
    const from = el(
      'select.input',
      {},
      days.map((day, index) =>
        el('option', { value: day, text: `${DAY_NAMES[index]} ${formatDate(fromDateKey(day))}` })
      )
    );
    const to = el(
      'select.input',
      {},
      // Offer the following week too — building next week from this one is the
      // single most common rota job.
      [...days, ...weekDays(addDays(state.week, 7))].map((day) =>
        el('option', { value: day, text: formatDate(fromDateKey(day)) })
      )
    );
    to.value = days[1];

    const modal = openModal({
      title: 'Copy a day’s shifts',
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Copy from' }), from]),
        el('label.field', {}, [el('span.field__label', { text: 'Copy to' }), to]),
        el('p.hint', { text: 'Shifts are added to the target day; anything already there stays.' }),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Copy shifts',
          onclick: async (event) => {
            if (from.value === to.value) {
              toast.error('Choose two different days.');
              return;
            }
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const count = await staffRepo.copyShifts(from.value, to.value);
              toast.success(`${count} shift${count === 1 ? '' : 's'} copied.`);
              modal.close();
              await paintRota();
              await paintHours();
            } catch (error) {
              reportError(error);
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  /* ---------------------------------------------------------- hours --- */

  async function paintHours() {
    const days = weekDays(state.week);
    const [attendance, shifts] = await Promise.all([
      staffRepo.attendanceBetween(days[0], days[6]),
      staffRepo.shiftsBetween(days[0], days[6]),
    ]);

    const rows = staffRepo.summariseHours(staffRepo.getStaff(), attendance, shifts, {
      from: days[0],
      to: days[6],
    });
    const worked = rows.filter((row) => row.minutes || row.rosteredMinutes || row.days);

    clear(hoursPanel);
    if (!worked.length) {
      hoursPanel.appendChild(
        el('p.empty', { text: 'No hours recorded this week yet.' })
      );
      return;
    }

    const totalPay = worked.reduce((sum, row) => sum + row.pay, 0);
    append(hoursPanel, [
      el('div.table', {}, [
        el('div.table__head.table__head--hours', {}, [
          el('span', { text: 'Staff' }),
          el('span.table__num', { text: 'Days in' }),
          el('span.table__num', { text: 'Rostered' }),
          el('span.table__num', { text: 'Worked' }),
          el('span.table__num', { text: 'Pay' }),
        ]),
        ...worked.map((row) =>
          el('div.table__row.table__row--hours', {}, [
            el('span', {}, [
              el('strong', { text: row.name }),
              el('span.hint', {
                text: [
                  row.absent ? `${row.absent} absent` : '',
                  row.leave ? `${row.leave} on leave` : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
              }),
            ]),
            el('span.table__num', { text: String(row.days) }),
            el('span.table__num', { text: staffRepo.formatDuration(row.rosteredMinutes) }),
            el('span.table__num', { text: staffRepo.formatDuration(row.minutes) }),
            el('span.table__num', { text: row.pay ? formatMoney(row.pay, symbol) : '—' }),
          ])
        ),
      ]),
      totalPay
        ? el('p.panel__line', {
            text: `Wages for the week, from hours actually worked: ${formatMoney(totalPay, symbol)}`,
          })
        : null,
    ]);
  }

  /* --------------------------------------------------------- assembly --- */

  async function paintAll() {
    await Promise.all([paintToday(), paintRota(), paintHours()]);
    paintPeople();
  }

  function shiftWeek(days) {
    state.week = addDays(state.week, days);
    paintRota();
    paintHours();
  }

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [
        el('h1.page__title', { text: 'Staff' }),
        el('p.page__sub', { text: 'Attendance, the rota, and the hours that came out of it.' }),
      ]),
      el('div.page__actions', {}, [
        el('button.btn.btn--ghost', { type: 'button', text: 'Copy a day', onclick: copyDayForm }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Add a member of staff',
          onclick: () => personForm(),
        }),
      ]),
    ]),

    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: `Today · ${formatDate(fromDateKey(today))}` }),
      todayPanel,
    ]),

    el('section.panel.panel--wide', {}, [
      el('div.rota__head', {}, [
        el('h2.panel__title', { text: 'Rota' }),
        el('div.rota__nav', {}, [
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: '‹ Previous',
            onclick: () => shiftWeek(-7),
          }),
          weekLabel,
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Next ›',
            onclick: () => shiftWeek(7),
          }),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'This week',
            onclick: () => {
              state.week = weekStart(toDateKey());
              paintRota();
              paintHours();
            },
          }),
        ]),
      ]),
      rotaPanel,
    ]),

    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: 'Hours this week' }),
      el('p.panel__line', {
        text: 'Worked hours come from clock-ins, less unpaid breaks. Rostered hours come from the rota above.',
      }),
      hoursPanel,
    ]),

    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: 'The team' }),
      peoplePanel,
    ]),
  ]);

  clear(outlet).appendChild(page);
  await paintAll();

  const unsubscribe = staffRepo.onStaffChange(() => paintAll());
  return () => unsubscribe();
}
