export interface PageAccess {
  namespace: string;
  code: string;
  name: string;
  isHaveAccess: boolean;
}

export interface ElmaAccount {
  id: string;
  name: string;
  baseUrl: string;
  portal: string;
  token: string;
  userId: string;
  cookies?: string;
  email?: string;
  color: string;
  isActive: boolean;
  userKind?: 'default' | 'portal';
  privileges?: string[];
  isPortal?: boolean;
  pagesAccess?: PageAccess[];
}
