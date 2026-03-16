/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc,
  getDocFromServer,
  deleteDoc,
  addDoc
} from 'firebase/firestore';
import { 
  LayoutDashboard, 
  Plus, 
  Search, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  ChevronRight, 
  LogOut, 
  User as UserIcon,
  Download,
  BarChart3,
  AlertCircle,
  Menu,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Fuse from 'fuse.js';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { auth, db, signIn, logOut } from './firebase';
import { DDProject, UserProfile, ProjectSource, ProjectStatus, ProjectHistory } from './types';
import { Logo } from './components/Logo';
import { Button } from './components/Button';
import { Card, Badge } from './components/UI';
import { FileUpload } from './components/FileUpload';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

// --- Main App ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  // If it's already a stringified FirestoreErrorInfo, don't re-wrap it
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed.authInfo && parsed.operationType) {
        throw error; // Re-throw the original error
      }
    } catch (e) {
      // Not a JSON error message, proceed with wrapping
    }
  }

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId || undefined,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<DDProject[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'projects' | 'reports'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectedStep, setInspectedStep] = useState<number | null>(null);
  const [filterStep, setFilterStep] = useState<number | 'ALL'>('ALL');
  const [selectedProject, setSelectedProject] = useState<DDProject | null>(null);
  const [revisionComment, setRevisionComment] = useState('');
  const [revisions, setRevisions] = useState<any[]>([]);
  const [media, setMedia] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectSource, setNewProjectSource] = useState<ProjectSource>('COMMERCIAL');
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setUserProfile(userDoc.data() as UserProfile);
          } else {
            // Create default profile for new users
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || 'User',
              role: firebaseUser.email === 'daniel.gandolfo@gmail.com' ? 'admin' : 'viewer',
              createdAt: new Date().toISOString(),
            };
            try {
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
            } catch (error) {
              handleFirestoreError(error, OperationType.CREATE, `users/${firebaseUser.uid}`);
            }
            setUserProfile(newProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Data Listener
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as DDProject[];
      setProjects(projectsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });

    return unsubscribe;
  }, [user, isAuthReady]);

  // Revisions and Media Listener
  useEffect(() => {
    if (!selectedProject) {
      setRevisions([]);
      setMedia([]);
      setInspectedStep(null);
      return;
    }
    setInspectedStep(null); // Also reset when switching projects

    const revisionsQuery = query(collection(db, 'projects', selectedProject.id, 'revisions'), orderBy('timestamp', 'desc'));
    const mediaQuery = query(collection(db, 'projects', selectedProject.id, 'media'), orderBy('createdAt', 'desc'));

    const unsubscribeRevisions = onSnapshot(revisionsQuery, (snapshot) => {
      setRevisions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `projects/${selectedProject.id}/revisions`);
    });

    const unsubscribeMedia = onSnapshot(mediaQuery, (snapshot) => {
      setMedia(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `projects/${selectedProject.id}/media`);
    });

    return () => {
      unsubscribeRevisions();
      unsubscribeMedia();
    };
  }, [selectedProject]);

  // Test connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  const filteredProjects = useMemo(() => {
    let filtered = projects;
    if (searchQuery) {
      const fuse = new Fuse(filtered, {
        keys: ['title', 'code', 'complaintNumber', 'description'],
        threshold: 0.3,
      });
      filtered = fuse.search(searchQuery).map(result => result.item);
    }
    
    if (filterStep !== 'ALL') {
      filtered = filtered.filter(p => p.currentStep === filterStep);
    }

    return filtered.sort((a, b) => a.currentStep - b.currentStep);
  }, [projects, searchQuery, filterStep]);

  const stats = useMemo(() => {
    const total = projects.length;
    const aprobado = projects.filter(p => p.status === 'APPROVED').length;
    const rechazado = projects.filter(p => p.status === 'REJECTED').length;
    const activo = projects.filter(p => p.status === 'ACTIVO').length;

    const sourceData = [
      { name: 'Comercial', value: projects.filter(p => p.source === 'COMMERCIAL').length },
      { name: 'Producción', value: projects.filter(p => p.source === 'PRODUCTION').length },
      { name: 'Reclamos', value: projects.filter(p => p.source === 'RECLAMO').length },
      { name: 'Diseño & Desarrollo', value: projects.filter(p => p.source === 'DESIGN_DEVELOPMENT').length },
    ];

    const stepData = [
      { name: 'Planificación', count: projects.filter(p => p.currentStep === 1).length },
      { name: 'Ejecución', count: projects.filter(p => p.currentStep === 2).length },
      { name: 'Controles', count: projects.filter(p => p.currentStep === 3).length },
      { name: 'Salidas', count: projects.filter(p => p.currentStep === 4).length },
      { name: 'Validación', count: projects.filter(p => p.currentStep === 5).length },
      { name: 'Aprobado', count: projects.filter(p => p.currentStep === 6).length },
      { name: 'Rechazado', count: projects.filter(p => p.currentStep === 7).length },
    ];

    return { total, approved: aprobado, rejected: rechazado, active: activo, sourceData, stepData };
  }, [projects]);

  const handleCreateProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userProfile || userProfile.role === 'viewer') return;

    const formData = new FormData(e.currentTarget);
    const nextCode = `DD${String(projects.length + 1).padStart(4, '0')}`;
    
    const newProject: Omit<DDProject, 'id'> = {
      code: nextCode,
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      source: formData.get('source') as ProjectSource,
      complaintNumber: formData.get('complaintNumber') as string || null,
      currentStep: 1,
      status: 'ACTIVE',
      history: [],
      planning: {
        responsible: formData.get('responsible') as string,
        startDate: new Date().toISOString().split('T')[0],
        inputs: '',
      },
      execution: { details: '', date: '' },
      controls: { review: '', verification: '' },
      outputs: { results: '' },
      validation: { check: '' },
      createdBy: userProfile.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(collection(db, 'projects')), newProject);
      setIsModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    }
  };

  const updateProjectStep = async (projectId: string, step: number, data: any, comment: string = '', action: string = '') => {
    const projectRef = doc(db, 'projects', projectId);
    const project = selectedProject;
    if (!project) return;

    let historyUpdates = project.history || [];
    
    // Solo agregar al historial si hay un cambio real de etapa, estado, o un comentario/acción explícita
    const isStepChange = project.currentStep !== step;
    const hasComment = comment.trim() !== '';
    const isExplicitAction = action !== '';
    
    // Check if there are data changes that should be logged
    let dataChangeComment = '';
    let dataChangeAction = '';
    
    if (!isStepChange && !hasComment && !isExplicitAction) {
      if (data['planning.inputs'] !== undefined && data['planning.inputs'] !== project.planning.inputs) {
        dataChangeAction = 'Actualización de Planificación';
        dataChangeComment = data['planning.inputs'];
      } else if (data['execution.details'] !== undefined && data['execution.details'] !== project.execution.details) {
        dataChangeAction = 'Actualización de Ejecución';
        dataChangeComment = data['execution.details'];
      } else if (data['controls.review'] !== undefined && data['controls.review'] !== project.controls.review) {
        dataChangeAction = 'Actualización de Revisión (Controles)';
        dataChangeComment = data['controls.review'];
      } else if (data['controls.verification'] !== undefined && data['controls.verification'] !== project.controls.verification) {
        dataChangeAction = 'Actualización de Verificación (Controles)';
        dataChangeComment = data['controls.verification'];
      } else if (data['outputs.results'] !== undefined && data['outputs.results'] !== project.outputs.results) {
        dataChangeAction = 'Actualización de Salidas';
        dataChangeComment = data['outputs.results'];
      } else if (data['validation.check'] !== undefined && data['validation.check'] !== project.validation.check) {
        dataChangeAction = 'Actualización de Validación';
        dataChangeComment = data['validation.check'];
      }
    }

    if (isStepChange || hasComment || isExplicitAction || dataChangeAction) {
      const newHistory: ProjectHistory = {
        id: crypto.randomUUID(),
        userId: auth.currentUser?.uid || 'system',
        userName: userProfile?.displayName || 'Sistema',
        date: new Date().toISOString(),
        action: action || dataChangeAction || (isStepChange ? 'Cambio de Etapa' : 'Actualización'),
        comment: comment || dataChangeComment,
        previousStep: project.currentStep,
        newStep: step
      };
      historyUpdates = [...historyUpdates, newHistory];
    }

    const updateData: any = {
      currentStep: step,
      updatedAt: new Date().toISOString(),
      history: historyUpdates,
      ...data
    };

    if (step === 6) updateData.status = 'APPROVED';
    else if (step === 7) updateData.status = 'REJECTED';
    else if (step === 8) updateData.status = 'EN_REVISION';
    else updateData.status = 'ACTIVE';

    try {
      await updateDoc(projectRef, updateData);
      setSelectedProject(prev => prev ? { ...prev, ...updateData } : null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  const deleteProject = async (projectId: string) => {
    try {
      await deleteDoc(doc(db, 'projects', projectId));
      setSelectedProject(null);
      setIsModalOpen(false);
    } catch (error) {
      console.error("Error deleting project:", error);
    }
  };

  const addCommentToHistory = async (projectId: string, comment: string) => {
    if (!comment.trim()) return;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const newHistory: ProjectHistory = {
      id: Date.now().toString(),
      userId: auth.currentUser?.uid || '',
      userName: userProfile?.displayName || 'Usuario',
      date: new Date().toISOString(),
      action: 'Comentario',
      comment,
      previousStep: project.currentStep,
      newStep: project.currentStep,
    };

    const updateData = {
      history: [...(project.history || []), newHistory],
      updatedAt: new Date().toISOString()
    };

    try {
      await updateDoc(doc(db, 'projects', projectId), updateData);
      setSelectedProject(prev => prev ? { ...prev, ...updateData } : null);
      setRevisionComment('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  const addRevision = async (projectId: string, comment: string) => {
    try {
      await addDoc(collection(db, 'projects', projectId, 'revisions'), {
        projectId,
        userId: auth.currentUser?.uid,
        userName: userProfile?.displayName,
        comment,
        timestamp: new Date()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}/revisions`);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'APPROVED': return 'Aprobado';
      case 'REJECTED': return 'Rechazado';
      case 'EN_REVISION': return 'En Revisión';
      case 'ACTIVE': return 'Activo';
      default: return status;
    }
  };

  const exportToPDF = (project: DDProject) => {
    const doc = new jsPDF();
    
    // RR Logo (Simplified representation for PDF)
    doc.setFillColor(239, 125, 0); // Orange #ef7d00
    doc.circle(25, 20, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('RR', 21, 22);
    
    doc.setTextColor(24, 24, 27); // Zinc-900
    doc.setFontSize(14);
    doc.text('Etiquetas', 38, 18);
    doc.setFontSize(8);
    doc.setTextColor(113, 113, 122); // Zinc-500
    doc.text('DISEÑO & DESARROLLO', 38, 23);
    
    // Header
    doc.setTextColor(24, 24, 27);
    doc.setFontSize(20);
    doc.text('Informe de Proyecto', 20, 45);
    
    doc.setFontSize(10);
    doc.setTextColor(113, 113, 122);
    doc.text(`Generado el: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 20, 52);
    
    doc.setFontSize(12);
    doc.setTextColor(24, 24, 27);
    doc.text(`Código: ${project.code}`, 20, 65);
    doc.text(`Título: ${project.title}`, 20, 72);
    doc.text(`Estado: ${getStatusLabel(project.status)}`, 20, 79);
    doc.text(`Fecha Creación: ${format(new Date(project.createdAt), 'dd/MM/yyyy')}`, 20, 86);

    // Table
    autoTable(doc, {
      startY: 95,
      head: [['Etapa', 'Detalles']],
      body: [
        ['1. Planificación', `Responsable: ${project.planning.responsible}\nInicio: ${project.planning.startDate}\nEntradas: ${project.planning.inputs}`],
        ['2. Ejecución', project.execution.details || 'Pendiente'],
        ['3. Controles', `Revisión: ${project.controls.review}\nVerificación: ${project.controls.verification}`],
        ['4. Salidas', project.outputs.results || 'Pendiente'],
        ['5. Validación', project.validation.check || 'Pendiente'],
      ],
      headStyles: { fillColor: [24, 24, 27] },
    });

    // Evidence Section
    let currentY = (doc as any).lastAutoTable.finalY + 20;
    doc.setFontSize(16);
    doc.text('Evidencias y Adjuntos', 20, currentY);
    currentY += 10;

    const projectMedia = media.filter(m => m.projectId === project.id);
    if (projectMedia.length > 0) {
      projectMedia.forEach((m, index) => {
        if (currentY > 250) {
          doc.addPage();
          currentY = 20;
        }
        doc.setFontSize(10);
        doc.text(`${index + 1}. [Etapa ${m.step}] ${m.name}`, 25, currentY);
        
        // If it's an image, we could try to add it, but since we don't have base64 easily here without async, 
        // we'll at least list them clearly as evidence.
        currentY += 8;
      });
    } else {
      doc.setFontSize(10);
      doc.setTextColor(113, 113, 122);
      doc.text('No se registraron archivos adjuntos.', 25, currentY);
    }

    doc.save(`${project.code}_Reporte_RR.pdf`);
  };

  const MediaSection = ({ step }: { step: number }) => {
    const stepMedia = media.filter(m => m.step === step);
    
    return (
      <div className="mt-6 space-y-4 border-t border-zinc-100 pt-6">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-zinc-700">Evidencias de la Etapa</h4>
          <FileUpload 
            projectId={selectedProject?.id || ''} 
            step={step} 
            onUploadComplete={(fileName) => addCommentToHistory(selectedProject?.id || '', `Subió el archivo: ${fileName}`)} 
          />
        </div>
        {stepMedia.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stepMedia.map(m => {
              const isVideo = m.type === 'video' || m.name.match(/\.(mp4|webm|ogg)$/i);
              const isImage = m.type === 'image' || m.name.match(/\.(jpeg|jpg|gif|png|webp)$/i);
              
              return (
                <div key={m.id} className="relative group rounded-lg border border-zinc-200 overflow-hidden bg-zinc-50 flex items-center justify-center aspect-video">
                  {isImage ? (
                    <img src={m.url} alt={m.name} className="object-cover w-full h-full" />
                  ) : isVideo ? (
                    <video src={m.url} controls className="object-cover w-full h-full" />
                  ) : (
                    <a href={m.url} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center p-4 text-zinc-600 hover:text-zinc-900 w-full h-full">
                      <FileText size={24} className="mb-2" />
                      <span className="text-[10px] text-center break-all line-clamp-2">{m.name}</span>
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 italic">No hay archivos adjuntos en esta etapa.</p>
        )}
      </div>
    );
  };

  const HistoryList = ({ history, projectId }: { history: ProjectHistory[], projectId: string }) => {
    const [chatComment, setChatComment] = useState('');

    const handleSend = () => {
      if (!chatComment.trim()) return;
      addCommentToHistory(projectId, chatComment);
      setChatComment('');
    };

    return (
      <div className="flex flex-col h-[600px] bg-white rounded-xl overflow-hidden border border-zinc-200">
        <div className="bg-zinc-50 border-b border-zinc-200 px-5 py-4 flex items-center justify-between z-10">
          <h3 className="font-semibold text-zinc-800">Historial y Comentarios</h3>
          <span className="text-xs font-medium text-zinc-500 bg-zinc-200 px-2 py-1 rounded-full">{history.length} eventos</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 space-y-6 flex flex-col-reverse bg-zinc-50/50">
          <div className="space-y-6 flex flex-col">
            {history.length === 0 ? (
              <p className="text-center text-sm text-zinc-500 py-4 mt-auto">No hay actividad aún en este proyecto.</p>
            ) : (
              history.map((h, index) => {
                const isCurrentUser = h.userId === auth.currentUser?.uid;
                const isComment = h.action === 'Comentario';
                
                return (
                  <div key={h.id} className="relative flex gap-4">
                    {/* Timeline line */}
                    {index !== history.length - 1 && (
                      <div className="absolute left-[19px] top-10 bottom-[-24px] w-px bg-zinc-200"></div>
                    )}
                    
                    {/* Avatar/Icon */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 z-10 ${
                      isComment ? 'bg-zinc-100 text-zinc-600' : 'bg-emerald-100 text-emerald-600'
                    }`}>
                      <span className="text-sm font-bold">
                        {h.userName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 bg-white border border-zinc-200 rounded-lg p-4 shadow-sm">
                      <div className="flex justify-between items-start mb-1">
                        <p className="text-sm font-semibold text-zinc-800">
                          {h.userName} <span className="font-normal text-zinc-500 ml-1">{h.action}</span>
                        </p>
                        <p className="text-xs text-zinc-400 whitespace-nowrap ml-4">
                          {format(new Date(h.date), 'dd/MM/yyyy HH:mm')}
                        </p>
                      </div>
                      {h.comment && (
                        <p className="text-sm text-zinc-600 mt-2 bg-zinc-50 p-3 rounded border border-zinc-100">
                          {h.comment}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white p-4 border-t border-zinc-200">
          <div className="flex items-end gap-3">
            <textarea 
              className="flex-1 rounded-lg border border-zinc-300 p-3 text-sm focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 resize-none max-h-32 min-h-[44px] transition-colors"
              placeholder="Agregar un comentario al historial..."
              value={chatComment}
              onChange={(e) => setChatComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
            />
            <Button 
              onClick={handleSend} 
              className="rounded-lg px-4 h-[46px] flex items-center justify-center shrink-0"
            >
              Comentar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent" />
          <p className="font-mono text-sm text-zinc-500">CARGANDO SISTEMA DE CALIDAD...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-zinc-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-8 text-center"
        >
          <div className="space-y-2">
            <div className="flex justify-center mb-6">
              <Logo className="h-32 w-auto text-zinc-900" />
            </div>
            <p className="text-zinc-500">Gestión de Diseño y Desarrollo ISO 9001:2015</p>
          </div>
          <Card className="p-8">
            <div className="mb-6 flex justify-center">
              <div className="rounded-full bg-zinc-100 p-4">
                <FileText className="h-8 w-8 text-zinc-900" />
              </div>
            </div>
            <h2 className="mb-2 text-xl font-semibold">Bienvenido al Portal de Calidad</h2>
            <p className="mb-8 text-sm text-zinc-500">Inicie sesión para gestionar los proyectos de auditoría y cumplimiento.</p>
            <Button onClick={signIn} className="w-full py-6 text-lg">
              Ingresar con Google
            </Button>
          </Card>
          <p className="text-xs text-zinc-400">© 2026 RR Etiquetas Uruguay SA - Sistema de Gestión de Calidad</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-50 text-zinc-900 font-sans">
      {/* Sidebar - Desktop */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 flex-col border-r border-zinc-200 bg-white transition-transform duration-300 md:static md:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 flex items-center justify-between">
          <div>
            <div className="mb-2">
              <Logo className="h-14 w-auto text-zinc-900" />
            </div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Diseño & Desarrollo</p>
              <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[8px] font-bold text-zinc-500">v2</span>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden">
            <X size={20} />
          </button>
        </div>
        
        <nav className="flex-1 space-y-1 px-3">
          <button 
            onClick={() => { setActiveTab('dashboard'); setIsSidebarOpen(false); }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeTab === 'dashboard' ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
            )}
          >
            <LayoutDashboard size={18} />
            D&D
          </button>
          <button 
            onClick={() => { setActiveTab('projects'); setIsSidebarOpen(false); }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeTab === 'projects' ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
            )}
          >
            <FileText size={18} />
            Proyectos
          </button>
          <button 
            onClick={() => { setActiveTab('reports'); setIsSidebarOpen(false); }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeTab === 'reports' ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
            )}
          >
            <BarChart3 size={18} />
            Estadísticas
          </button>
        </nav>

        <div className="border-t border-zinc-200 p-4">
          <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200">
              <UserIcon size={16} className="text-zinc-600" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-xs font-medium">{userProfile?.displayName}</p>
              <p className="text-[10px] uppercase text-zinc-400">{userProfile?.role}</p>
            </div>
            <button onClick={logOut} className="text-zinc-400 hover:text-red-500">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile sidebar */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/80 px-4 py-4 backdrop-blur-md md:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden">
              <Menu size={20} />
            </button>
            <h2 className="text-lg font-semibold capitalize md:text-xl flex items-center gap-3 md:gap-4">
              <Logo className="h-8 md:h-10 w-auto" />
              <div className="h-6 md:h-8 w-px bg-orange-500" />
              {activeTab === 'dashboard' ? 'Diseño & Desarrollo' : activeTab === 'projects' ? 'Proyectos' : 'Estadísticas'}
            </h2>
          </div>
        </header>

        <div className="p-4 md:p-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-6 md:space-y-8">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="relative flex-1 w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="Buscar proyectos..." 
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white pl-10 pr-4 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 shadow-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                {userProfile?.role !== 'viewer' && (
                  <Button onClick={() => setIsModalOpen(true)} className="h-11 w-full sm:w-auto gap-2 shadow-sm">
                    <Plus size={16} /> Nuevo Proyecto
                  </Button>
                )}
              </div>
              <Card className="overflow-hidden">
                <div className="border-b border-zinc-100 bg-zinc-50 px-6 py-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                    {searchQuery ? 'Resultados de Búsqueda' : 'Proyectos Recientes'}
                  </h3>
                </div>
                <div className="divide-y divide-zinc-100">
                  {filteredProjects.slice(0, 5).map(project => (
                    <div key={project.id} className="flex items-center justify-between p-6 hover:bg-zinc-50">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 font-mono text-xs font-bold">
                          {project.code}
                        </div>
                        <div>
                          <p className="font-medium">{project.title}</p>
                          <p className="text-xs text-zinc-500">{format(new Date(project.createdAt), 'dd MMM yyyy')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant={project.status === 'APPROVED' ? 'success' : project.status === 'REJECTED' ? 'danger' : 'info'}>
                          {getStatusLabel(project.status)}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedProject(project); setActiveTab('projects'); }}>
                          Ver Detalles
                        </Button>
                      </div>
                    </div>
                  ))}
                  {filteredProjects.length === 0 && (
                    <div className="p-6 text-center text-zinc-500">No se encontraron proyectos.</div>
                  )}
                </div>
              </Card>

              <div className="grid grid-cols-2 gap-4 max-w-4xl">
                <Card className="p-4">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Total Proyectos</p>
                  <p className="mt-1 text-2xl font-bold">{stats.total}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Activos</p>
                  <p className="mt-1 text-2xl font-bold text-blue-600">{stats.active}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Aprobados</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-600">{stats.approved}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Rechazados</p>
                  <p className="mt-1 text-2xl font-bold text-red-600">{stats.rejected}</p>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card className="p-6">
                  <h3 className="mb-6 text-sm font-semibold uppercase tracking-wider text-zinc-500">Proyectos por Etapa</h3>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.stepData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" fontSize={10} />
                        <YAxis fontSize={10} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#18181b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card className="p-6">
                  <h3 className="mb-6 text-sm font-semibold uppercase tracking-wider text-zinc-500">Origen de Proyectos</h3>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={stats.sourceData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          <Cell fill="#18181b" />
                          <Cell fill="#71717a" />
                          <Cell fill="#d4d4d8" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="space-y-6">
              {!selectedProject ? (
                <>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="relative flex-1 w-full">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                      <input 
                        type="text" 
                        placeholder="Buscar proyectos..." 
                        className="h-11 w-full rounded-lg border border-zinc-200 bg-white pl-10 pr-4 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 shadow-sm"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                    <select 
                      value={filterStep} 
                      onChange={(e) => setFilterStep(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                      className="h-11 w-full sm:w-auto rounded-lg border border-zinc-200 bg-white px-4 text-sm focus:border-zinc-900 focus:outline-none shadow-sm"
                    >
                      <option value="ALL">Todas las etapas</option>
                      <option value={1}>1 - Planificación</option>
                      <option value={2}>2 - Ejecución</option>
                      <option value={3}>3 - Controles</option>
                      <option value={4}>4 - Salidas</option>
                      <option value={5}>5 - Validación</option>
                      <option value={6}>6 - Aprobado</option>
                      <option value={7}>7 - Rechazado</option>
                      <option value={8}>8 - En Revisión</option>
                    </select>
                    {userProfile?.role !== 'viewer' && (
                      <Button onClick={() => setIsModalOpen(true)} className="h-11 w-full sm:w-auto gap-2 shadow-sm">
                        <Plus size={16} /> Nuevo Proyecto
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {filteredProjects.map(project => (
                    <Card key={project.id} className="group cursor-pointer p-6 transition-all hover:border-zinc-900" onClick={() => setSelectedProject(project)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-6">
                          <span className="font-mono text-sm font-bold text-zinc-400">{project.code}</span>
                          <div>
                            <h3 className="font-semibold">{project.title}</h3>
                            <p className="text-sm text-zinc-500">{project.description}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-8">
                          <div className="text-right">
                            <p className="text-[10px] uppercase text-zinc-400">Etapa Actual</p>
                            <p className="text-sm font-medium">
                              {project.currentStep === 1 && 'Planificación'}
                              {project.currentStep === 2 && 'Ejecución'}
                              {project.currentStep === 3 && 'Controles'}
                              {project.currentStep === 4 && 'Salidas'}
                              {project.currentStep === 5 && 'Validación'}
                              {project.currentStep === 6 && 'Aprobado'}
                              {project.currentStep === 7 && 'Rechazado'}
                            </p>
                          </div>
                          <Badge variant={project.status === 'APPROVED' ? 'success' : project.status === 'REJECTED' ? 'danger' : 'info'}>
                            {getStatusLabel(project.status)}
                          </Badge>
                          <ChevronRight className="text-zinc-300 group-hover:text-zinc-900" />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                </>
              ) : (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                  <div className="flex items-center justify-between">
                    <Button variant="ghost" onClick={() => setSelectedProject(null)} className="gap-2">
                      ← Volver a la lista
                    </Button>
                    <div className="flex gap-2">
                      {['APPROVED', 'REJECTED'].includes(selectedProject.status) && userProfile?.role === 'admin' && (
                        <Button variant="outline" onClick={() => updateProjectStep(selectedProject.id, 5, { status: 'ACTIVE' }, 'Proyecto reabierto por administrador', 'Reapertura')} className="gap-2">
                          <AlertCircle size={16} /> Reabrir Proyecto
                        </Button>
                      )}
                      <Button variant="outline" onClick={() => exportToPDF(selectedProject)} className="gap-2">
                        <Download size={16} /> Exportar PDF
                      </Button>
                      <Button variant="danger" onClick={() => deleteProject(selectedProject.id)} className="gap-2">
                        Borrar Proyecto
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    <div className="lg:col-span-2 space-y-8">
                      <Card className="p-8">
                        <div className="mb-8 flex items-center justify-between">
                          <div>
                            <span className="font-mono text-sm text-zinc-400">{selectedProject.code}</span>
                            <h2 className="text-2xl font-bold">{selectedProject.title}</h2>
                          </div>
                          <Badge variant={selectedProject.status === 'APPROVED' ? 'success' : selectedProject.status === 'REJECTED' ? 'danger' : 'info'}>
                            {getStatusLabel(selectedProject.status)}
                          </Badge>
                        </div>

                        {/* Step Progress */}
                        <div className="mb-12">
                          <div className="relative flex justify-between">
                            {[1, 2, 3, 4, 5].map((step) => (
                              <button 
                                key={step} 
                                onClick={() => setInspectedStep(inspectedStep === step ? null : step)}
                                className={cn(
                                  "relative z-10 flex flex-col items-center gap-2 transition-transform hover:scale-110",
                                  inspectedStep === step && "scale-110"
                                )}
                              >
                                <div className={cn(
                                  "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all shadow-sm",
                                  selectedProject.currentStep >= step 
                                    ? "border-zinc-900 bg-zinc-900 text-white" 
                                    : "border-zinc-200 bg-white text-zinc-400",
                                  inspectedStep === step && "ring-4 ring-orange-500/20 border-orange-500"
                                )}>
                                  {selectedProject.currentStep > step ? <CheckCircle2 size={20} /> : <span className="text-sm font-bold">{step}</span>}
                                </div>
                                <span className={cn(
                                  "text-[10px] font-bold uppercase tracking-tighter transition-colors",
                                  inspectedStep === step ? "text-orange-600" : "text-zinc-500"
                                )}>
                                  {step === 1 && 'Planificación'}
                                  {step === 2 && 'Ejecución'}
                                  {step === 3 && 'Controles'}
                                  {step === 4 && 'Salidas'}
                                  {step === 5 && 'Validación'}
                                </span>
                              </button>
                            ))}
                            <div className="absolute left-0 top-5 -z-0 h-0.5 w-full bg-zinc-100" />
                            <div 
                              className="absolute left-0 top-5 -z-0 h-0.5 bg-zinc-900 transition-all duration-500" 
                              style={{ width: `${((selectedProject.currentStep - 1) / 4) * 100}%` }}
                            />
                          </div>
                          
                          {/* Step Inspection Panel */}
                          <AnimatePresence>
                            {inspectedStep && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="mt-8 overflow-hidden"
                              >
                                <Card className="bg-zinc-50 border-zinc-200 p-6">
                                  <div className="flex items-center justify-between mb-6">
                                    <div className="flex items-center gap-3">
                                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-white text-sm font-bold">
                                        {inspectedStep}
                                      </div>
                                      <h4 className="font-bold text-zinc-900">
                                        Detalles de Etapa: {
                                          inspectedStep === 1 ? 'Planificación' :
                                          inspectedStep === 2 ? 'Ejecución' :
                                          inspectedStep === 3 ? 'Controles' :
                                          inspectedStep === 4 ? 'Salidas' : 'Validación'
                                        }
                                      </h4>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setInspectedStep(null)}>Cerrar</Button>
                                  </div>
                                  
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                      <h5 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Archivos de esta etapa</h5>
                                      <div className="grid grid-cols-2 gap-3">
                                        {media.filter(m => m.step === inspectedStep && m.projectId === selectedProject.id).map(m => (
                                          <div key={m.id} className="flex items-center gap-2 p-2 rounded border border-zinc-200 bg-white shadow-sm">
                                            <FileText size={14} className="text-zinc-400" />
                                            <span className="text-[10px] truncate flex-1">{m.name}</span>
                                            <a href={m.url} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-900">
                                              <Download size={12} />
                                            </a>
                                          </div>
                                        ))}
                                        {media.filter(m => m.step === inspectedStep && m.projectId === selectedProject.id).length === 0 && (
                                          <p className="text-xs text-zinc-400 italic">No hay archivos.</p>
                                        )}
                                      </div>
                                    </div>
                                    
                                    <div className="space-y-4">
                                      <h5 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Comentarios de esta etapa</h5>
                                      <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2">
                                        {selectedProject.history?.filter(h => h.newStep === inspectedStep || h.previousStep === inspectedStep).map(h => (
                                          <div key={h.id} className="text-[11px] border-l-2 border-zinc-200 pl-3 py-1">
                                            <p className="font-bold text-zinc-700">{h.action}</p>
                                            {h.comment && <p className="text-zinc-600 italic">"{h.comment}"</p>}
                                            <p className="text-[9px] text-zinc-400 mt-1">{format(new Date(h.date), 'dd/MM HH:mm')}</p>
                                          </div>
                                        ))}
                                        {(!selectedProject.history || selectedProject.history.filter(h => h.newStep === inspectedStep || h.previousStep === inspectedStep).length === 0) && (
                                          <p className="text-xs text-zinc-400 italic">Sin comentarios.</p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </Card>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* Step Content */}
                        <div className="space-y-8">
                          {selectedProject.currentStep === 1 && (
                            <div className="space-y-4">
                              <h4 className="font-semibold">Paso 1: Planificación y Elementos de Entrada</h4>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="text-xs font-medium text-zinc-500">Responsable</label>
                                  <p className="text-sm">{selectedProject.planning.responsible}</p>
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-zinc-500">Fecha de Inicio</label>
                                  <p className="text-sm">{selectedProject.planning.startDate}</p>
                                </div>
                              </div>
                              <textarea 
                                placeholder="Describa los elementos de entrada (requisitos, normas, etc)..."
                                className="w-full rounded-lg border border-zinc-200 p-3 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                                rows={4}
                                defaultValue={selectedProject.planning.inputs}
                                onBlur={(e) => updateProjectStep(selectedProject.id, 1, { 'planning.inputs': e.target.value })}
                              />
                              <MediaSection step={1} />
                              <Button onClick={() => { updateProjectStep(selectedProject.id, 2, {}, revisionComment, 'Pasar a Ejecución'); setRevisionComment(''); }}>Pasar a Ejecución</Button>
                            </div>
                          )}

                          {selectedProject.currentStep === 2 && (
                            <div className="space-y-4">
                              <h4 className="font-semibold">Paso 2: Ejecución</h4>
                              <textarea 
                                placeholder="Detalles de la ejecución técnica..."
                                className="w-full rounded-md border border-zinc-200 p-3 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                                rows={6}
                                defaultValue={selectedProject.execution.details}
                                onBlur={(e) => updateProjectStep(selectedProject.id, 2, { 'execution.details': e.target.value, 'execution.date': new Date().toISOString() })}
                              />
                              <MediaSection step={2} />
                              <div className="flex gap-4">
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 1, {}, revisionComment, 'Volver a Planificación'); setRevisionComment(''); }} variant="outline">Volver a Planificación</Button>
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 3, {}, revisionComment, 'Pasar a Controles'); setRevisionComment(''); }}>Pasar a Controles</Button>
                              </div>
                            </div>
                          )}

                          {selectedProject.currentStep === 3 && (
                            <div className="space-y-4">
                              <h4 className="font-semibold">Paso 3: Controles (Revisión y Verificación)</h4>
                              <div className="space-y-4">
                                <div>
                                  <label className="text-xs font-medium text-zinc-500">Revisión</label>
                                  <textarea 
                                    className="w-full rounded-md border border-zinc-200 p-3 text-sm"
                                    defaultValue={selectedProject.controls.review}
                                    onBlur={(e) => updateProjectStep(selectedProject.id, 3, { 'controls.review': e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-zinc-500">Verificación</label>
                                  <textarea 
                                    className="w-full rounded-md border border-zinc-200 p-3 text-sm"
                                    defaultValue={selectedProject.controls.verification}
                                    onBlur={(e) => updateProjectStep(selectedProject.id, 3, { 'controls.verification': e.target.value })}
                                  />
                                </div>
                              </div>
                              <MediaSection step={3} />
                              <div className="flex gap-4">
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 2, {}, revisionComment, 'Volver a Ejecución'); setRevisionComment(''); }} variant="outline">Volver a Ejecución</Button>
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 4, {}, revisionComment, 'Pasar a Salidas'); setRevisionComment(''); }}>Pasar a Salidas</Button>
                              </div>
                            </div>
                          )}

                          {selectedProject.currentStep === 4 && (
                            <div className="space-y-4">
                              <h4 className="font-semibold">Paso 4: Salidas del D&D</h4>
                              <textarea 
                                placeholder="Resultados finales, planos, especificaciones..."
                                className="w-full rounded-md border border-zinc-200 p-3 text-sm"
                                rows={6}
                                defaultValue={selectedProject.outputs.results}
                                onBlur={(e) => updateProjectStep(selectedProject.id, 4, { 'outputs.results': e.target.value })}
                              />
                              <MediaSection step={4} />
                              <div className="flex gap-4">
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 3, {}, revisionComment, 'Volver a Controles'); setRevisionComment(''); }} variant="outline">Volver a Controles</Button>
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 5, {}, revisionComment, 'Pasar a Validación'); setRevisionComment(''); }}>Pasar a Validación</Button>
                              </div>
                            </div>
                          )}

                          {selectedProject.currentStep === 5 && (
                            <div className="space-y-4">
                              <h4 className="font-semibold">Paso 5: Validación Final</h4>
                              <textarea 
                                placeholder="Evidencia de que el producto cumple con el uso previsto..."
                                className="w-full rounded-md border border-zinc-200 p-3 text-sm"
                                rows={6}
                                defaultValue={selectedProject.validation.check}
                                onBlur={(e) => updateProjectStep(selectedProject.id, 5, { 'validation.check': e.target.value })}
                              />
                              <MediaSection step={5} />
                              <div className="flex flex-wrap gap-4">
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 4, {}, revisionComment, 'Volver a Salidas'); setRevisionComment(''); }} variant="outline">Volver a Salidas</Button>
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 6, {}, revisionComment, 'Aprobar Proyecto'); setRevisionComment(''); }} className="bg-emerald-600 hover:bg-emerald-700">Aprobar Proyecto</Button>
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 7, {}, revisionComment, 'Rechazar Proyecto'); setRevisionComment(''); }} variant="danger">Rechazar Proyecto</Button>
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 8, {}, revisionComment, 'Enviar a Revisión'); setRevisionComment(''); }} variant="outline">Enviar a Revisión</Button>
                              </div>
                            </div>
                          )}

                          {selectedProject.currentStep === 8 && (
                            <div className="space-y-4">
                              <h4 className="font-semibold">Paso 8: En Revisión</h4>
                              <p className="text-sm text-zinc-500">El proyecto está siendo revisado. Por favor, tome una decisión.</p>
                              <div className="space-y-2">
                                <textarea 
                                  className="w-full rounded-lg border border-zinc-200 p-2.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                                  placeholder="Escriba un comentario sobre la revisión..."
                                  value={revisionComment}
                                  onChange={(e) => setRevisionComment(e.target.value)}
                                />
                                <div className="flex justify-end">
                                  <Button size="sm" variant="ghost" onClick={() => addCommentToHistory(selectedProject.id, revisionComment)}>OK</Button>
                                </div>
                              </div>
                              <div className="flex gap-4">
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 6, { status: 'APPROVED' }, revisionComment, 'Aprobar Proyecto'); setRevisionComment(''); }} className="bg-emerald-600 hover:bg-emerald-700">Aprobar</Button>
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 7, { status: 'REJECTED' }, revisionComment, 'Rechazar Proyecto'); setRevisionComment(''); }} variant="danger">Rechazar</Button>
                                <Button onClick={() => { updateProjectStep(selectedProject.id, 5, { status: 'ACTIVE' }, revisionComment, 'Devolver a Validación'); setRevisionComment(''); }} variant="outline">Devolver a Validación</Button>
                              </div>
                            </div>
                          )}

                          {selectedProject.currentStep >= 6 && (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                              {selectedProject.status === 'APPROVED' ? (
                                <>
                                  <div className="mb-4 rounded-full bg-emerald-100 p-4 text-emerald-600">
                                    <CheckCircle2 size={48} />
                                  </div>
                                  <h3 className="text-2xl font-bold text-emerald-900">Proyecto Aprobado</h3>
                                  <p className="text-zinc-500">Este proyecto ha completado todas las etapas de calidad satisfactoriamente.</p>
                                </>
                              ) : selectedProject.status === 'REJECTED' ? (
                                <>
                                  <div className="mb-4 rounded-full bg-red-100 p-4 text-red-600">
                                    <XCircle size={48} />
                                  </div>
                                  <h3 className="text-2xl font-bold text-red-900">Proyecto Rechazado</h3>
                                  <p className="text-zinc-500">Este proyecto no ha cumplido con los estándares de validación requeridos.</p>
                                </>
                              ) : (
                                <p className="text-zinc-500">Estado: {selectedProject.status}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </Card>
                    </div>

                    <div className="space-y-6">
                      <Card className="p-6">
                        <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Información General</h4>
                        <div className="space-y-4">
                          <div>
                            <p className="text-[10px] uppercase text-zinc-400">Origen</p>
                            <p className="text-sm font-medium">{selectedProject.source === 'RECLAMO' ? 'Reclamo' : selectedProject.source === 'COMMERCIAL' ? 'Dpto. Comercial' : selectedProject.source === 'DESIGN_DEVELOPMENT' ? 'Diseño & Desarrollo' : 'Producción'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-zinc-400">Creado por</p>
                            <p className="text-sm font-medium">{userProfile?.displayName || 'Usuario'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-zinc-400">Fecha Creación</p>
                            <p className="text-sm font-medium">{format(new Date(selectedProject.createdAt), 'dd/MM/yyyy HH:mm')}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-zinc-400">Última Actualización</p>
                            <p className="text-sm font-medium">{format(new Date(selectedProject.updatedAt), 'dd/MM/yyyy HH:mm')}</p>
                          </div>
                        </div>
                      </Card>

                      <Card className="p-6 bg-zinc-900 text-white">
                        <div className="flex items-center gap-2 mb-4">
                          <AlertCircle size={16} className="text-amber-400" />
                          <h4 className="text-xs font-semibold uppercase tracking-wider">Nota de Auditoría</h4>
                        </div>
                        <p className="text-xs leading-relaxed opacity-80">
                          Este registro cumple con el requisito 8.3 de la norma ISO 9001:2015. 
                          Asegúrese de adjuntar evidencias físicas de cada etapa en el archivo maestro.
                        </p>
                      </Card>
                      <HistoryList history={selectedProject.history || []} projectId={selectedProject.id} />
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="flex h-[60vh] flex-col items-center justify-center text-center">
              <BarChart3 size={48} className="mb-4 text-zinc-300" />
              <h3 className="text-xl font-semibold">Módulo de Estadísticas Avanzadas</h3>
              <p className="max-w-md text-zinc-500">
                Aquí podrá visualizar tendencias de cumplimiento, tiempos promedio por etapa y desempeño por responsable.
              </p>
              <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-2xl">
                <Card className="p-4 bg-white">
                  <p className="text-[10px] uppercase text-zinc-400">Tiempo Promedio</p>
                  <p className="text-xl font-bold">12 Días</p>
                </Card>
                <Card className="p-4 bg-white">
                  <p className="text-[10px] uppercase text-zinc-400">Tasa Aprobación</p>
                  <p className="text-xl font-bold">88%</p>
                </Card>
                <Card className="p-4 bg-white">
                  <p className="text-[10px] uppercase text-zinc-400">Proyectos/Mes</p>
                  <p className="text-xl font-bold">4.2</p>
                </Card>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg rounded-xl bg-white p-8 shadow-2xl"
            >
              <h3 className="mb-6 text-xl font-bold">Nuevo Proyecto</h3>
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium uppercase text-zinc-500">Título del Proyecto</label>
                  <input name="title" required className="mt-1 w-full rounded-lg border border-zinc-200 p-2.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase text-zinc-500">Descripción / Alcance</label>
                  <textarea name="description" className="mt-1 w-full rounded-lg border border-zinc-200 p-2.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900" rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium uppercase text-zinc-500">Origen</label>
                    <select name="source" value={newProjectSource} onChange={(e) => setNewProjectSource(e.target.value as ProjectSource)} className="mt-1 w-full rounded-lg border border-zinc-200 p-2.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900">
                      <option value="COMMERCIAL">Dpto. Comercial</option>
                      <option value="PRODUCTION">Producción</option>
                      <option value="RECLAMO">Reclamo</option>
                      <option value="DESIGN_DEVELOPMENT">Diseño & Desarrollo</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium uppercase text-zinc-500">Responsable</label>
                    <input name="responsible" defaultValue={userProfile?.displayName} required className="mt-1 w-full rounded-lg border border-zinc-200 p-2.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                  </div>
                </div>
                {newProjectSource === 'RECLAMO' && (
                  <div>
                    <label className="block text-xs font-medium uppercase text-zinc-500">Número de Reclamo</label>
                    <input name="complaintNumber" required className="mt-1 w-full rounded-lg border border-zinc-200 p-2.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                  <Button type="submit">Crear Registro</Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
