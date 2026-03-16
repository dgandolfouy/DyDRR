export type UserRole = 'admin' | 'auditor' | 'viewer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export type ProjectSource = 'COMMERCIAL' | 'PRODUCTION' | 'RECLAMO' | 'DESIGN_DEVELOPMENT';
export type ProjectStatus = 'ACTIVE' | 'EN_REVISION' | 'APPROVED' | 'REJECTED';

export interface ProjectHistory {
  id: string;
  userId: string;
  userName: string;
  date: string;
  action: string;
  comment: string;
  previousStep: number;
  newStep: number;
}

export interface DDProject {
  id: string;
  code: string;
  title: string;
  description: string;
  source: ProjectSource;
  complaintNumber?: string | null;
  currentStep: number;
  status: ProjectStatus;
  history: ProjectHistory[];
  planning: {
    responsible: string;
    startDate: string;
    inputs: string;
  };
  execution: {
    details: string;
    date: string;
  };
  controls: {
    review: string;
    verification: string;
  };
  outputs: {
    results: string;
  };
  validation: {
    check: string;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
