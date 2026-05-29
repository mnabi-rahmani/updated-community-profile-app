export interface Region {
  code: string;
  name: string;
  nameDari: string;
}

export const REGIONS: Region[] = [
  { code: 'SE', name: 'South Eastern',    nameDari: 'جنوب ختیځه حوزه' },
  { code: 'SR', name: 'Southern',         nameDari: 'جنوبی حوزه' },
  { code: 'ER', name: 'Eastern',          nameDari: 'ختیځه حوزه' },
  { code: 'CR', name: 'Capital',          nameDari: 'مرکزی حوزه' },
  { code: 'NE', name: 'North Eastern',    nameDari: 'سهیل ختیځه حوزه' },
  { code: 'CH', name: 'Central Highland', nameDari: 'لوړه مرکزی حوزه' },
  { code: 'NR', name: 'Northern',         nameDari: 'سهیلی حوزه' },
  { code: 'WR', name: 'Western',          nameDari: 'لویدیځه حوزه' },
];
