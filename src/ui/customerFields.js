/**
 * The three things the cafe asks a customer for: phone, name, birthday.
 *
 * One definition, used by the quick add at the counter and by the customer
 * screen, so a birthday typed at the till is validated exactly the way one
 * typed by the manager is.
 */

import { el } from '../core/utils.js';
import { formatBirthday } from '../repositories/customers.repo.js';

/**
 * @param {object|null} customer  the record being edited, or null for a new one
 * @param {{phone?:string, lockPhone?:boolean}} options
 * @returns {{node:HTMLElement, read:() => object, focus:() => void, phoneInput:HTMLInputElement}}
 */
export function customerFields(customer = null, { phone = '', lockPhone = false } = {}) {
  const phoneInput = el('input.input', {
    type: 'tel',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: '98765 43210',
    maxlength: 18,
    value: customer?.phone || phone || '',
    disabled: lockPhone,
  });

  const nameInput = el('input.input', {
    type: 'text',
    placeholder: 'Name',
    maxlength: 60,
    value: customer?.name || '',
  });

  // A plain text field, not a date picker: a customer gives a day and a month,
  // and half of them would rather not give a year at all.
  const birthdayInput = el('input.input', {
    type: 'text',
    placeholder: 'DD/MM',
    maxlength: 12,
    value: customer?.birthday
      ? `${customer.birthday.split('-')[1]}/${customer.birthday.split('-')[0]}${
          customer.birthYear ? `/${customer.birthYear}` : ''
        }`
      : '',
  });

  const notesInput = el('input.input', {
    type: 'text',
    placeholder: 'Usual order, allergies, anything worth remembering',
    maxlength: 200,
    value: customer?.notes || '',
  });

  const node = el('div.stack', {}, [
    el('label.field', {}, [
      el('span.field__label', { text: 'Phone number' }),
      phoneInput,
      el('span.hint', { text: 'How the customer is looked up next time. Digits only.' }),
    ]),
    el('div.formrow', {}, [
      el('label.field', {}, [el('span.field__label', { text: 'Name' }), nameInput]),
      el('label.field', {}, [
        el('span.field__label', { text: 'Birthday' }),
        birthdayInput,
        el('span.hint', {
          text: customer?.birthday
            ? `Currently ${formatBirthday(customer.birthday)}.`
            : 'Day and month. The year is optional.',
        }),
      ]),
    ]),
    el('label.field', {}, [el('span.field__label', { text: 'Notes' }), notesInput]),
  ]);

  return {
    node,
    phoneInput,
    focus: () => (lockPhone ? nameInput : phoneInput).focus(),
    read: () => ({
      phone: phoneInput.value,
      name: nameInput.value,
      birthday: birthdayInput.value,
      notes: notesInput.value,
    }),
  };
}
