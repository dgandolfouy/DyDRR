export type UserRole = 'admin' | 'auditor' | 'viewer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export type ProjectSource = 'CALIDAD' | 'GERENCIA' | 'ARTE' | 'COMMERCIAL' | 'PRODUCTION' | 'RECLAMO';
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

export interface CoordinationEntry {
  id: string;
  date: string;
  from: string;
  to: string;
  agreement: string;
  userId: string;
  userName: string;
}

export interface VersionChange {
  id: string;
  date: string;
  description: string;
  requestedBy: string;
  impact: string;
  userId: string;
  userName: string;
}

export interface DDProject {
  id: string;
  code: string;
  title: string;
  description: string;
  source: ProjectSource;
  trelloLink?: string | null;
  complaintNumber?: string | null;
  currentStep: number;
  status: ProjectStatus;
  history: ProjectHistory[];
  coordinationLog?: CoordinationEntry[];
  versionChanges?: VersionChange[];
  planning: {
    responsible: string;
    startDate: string;
    functionalRequirements: string;
    legalRequirements: string;
    previousDesigns: string;
    risksAndFailures: string;
    criticalResources: string;
  };
  execution: {
    details: string;
    date: string;
    initialValidationResult: string;
    initialValidationEvidence: string; // URL or reference
  };
  controls: {
    reviewMinutes: string;
    verificationConfirmation: boolean;
  };
  outputs: {
    results: string;
  };
  validation: {
    finalValidation: string;
    contrastWithInitial: string;
  };
  createdBy: string;
  creatorName: string;
  creatorEmail: string;
  createdAt: string;
  updatedAt: string;
}
