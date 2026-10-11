export interface UserProfile {
  id: string;
  userName: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  raw: Record<string, unknown>;
}
