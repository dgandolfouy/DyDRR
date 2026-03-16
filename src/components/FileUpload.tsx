import React, { useState } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from '../firebase';
import { Button } from './Button';
import { Upload, Loader2 } from 'lucide-react';

interface FileUploadProps {
  projectId: string;
  step: number;
  onUploadComplete: (fileName: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ projectId, step, onUploadComplete }) => {
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;

    setUploading(true);
    setErrorMsg(null);
    try {
      // Create a timeout promise to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Tiempo de espera agotado. Verifique su conexión o si Firebase Storage está habilitado.")), 15000)
      );

      const storageRef = ref(storage, `projects/${projectId}/media/${Date.now()}_${file.name}`);
      
      // Race the upload against the timeout
      const snapshot = await Promise.race([
        uploadBytes(storageRef, file),
        timeoutPromise
      ]) as any;

      const downloadURL = await getDownloadURL(snapshot.ref);

      let type = 'document';
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('video/')) type = 'video';
      else if (file.type.startsWith('audio/')) type = 'audio';

      await addDoc(collection(db, 'projects', projectId, 'media'), {
        projectId,
        step,
        type,
        name: file.name,
        url: downloadURL,
        createdAt: serverTimestamp(),
      });

      onUploadComplete(file.name);
    } catch (error: any) {
      console.error("Error uploading file:", error);
      setErrorMsg("Error al subir el archivo.");
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      setUploading(false);
      // Reset input so the same file can be selected again
      e.target.value = '';
    }
  };

  const inputId = `file-upload-${step}`;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          type="file"
          id={inputId}
          className="hidden"
          onChange={handleFileChange}
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
        />
        <label htmlFor={inputId}>
          <Button as="span" variant="outline" size="sm" className="gap-2 cursor-pointer">
            {uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            {uploading ? 'Subiendo...' : 'Subir Archivo'}
          </Button>
        </label>
      </div>
      {errorMsg && <span className="text-[10px] text-red-500">{errorMsg}</span>}
    </div>
  );
};
