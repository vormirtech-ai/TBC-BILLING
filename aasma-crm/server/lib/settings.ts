import { prisma } from './prisma';
import { settingsSchema, type SettingsInput } from '../../shared/schemas';

export type AppSettings = ReturnType<typeof settingsSchema.parse>;

export const DEFAULT_SETTINGS: AppSettings = settingsSchema.parse({
  companyName: 'Aasma Construction',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  gstNo: '',
  currency: '₹',
  financialYearStart: '04-01',
  lowStockAlerts: true,
  followUpReminderDays: 3,
});

const SETTINGS_KEY = 'app.settings';

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return DEFAULT_SETTINGS;
  try {
    return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(row.value) });
  } catch {
    // A hand-edited or truncated value should not lock the user out of the app.
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(input: SettingsInput): Promise<AppSettings> {
  const parsed = settingsSchema.parse(input);
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: JSON.stringify(parsed) },
    update: { value: JSON.stringify(parsed) },
  });
  return parsed;
}
