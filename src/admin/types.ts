export type AdminOverview = {
  viewer: string;
  accounts: { email: string; role: 'admin' | 'member'; sessions: number }[];
  configuration: { google: boolean; database: boolean; line: boolean; calendar: boolean };
};
