'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileText, X, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface DocumentUploadDialogProps {
    open: boolean;
    onClose: () => void;
    referenceId: string;
    referenceTitle: string;
    authToken: string | null;
    onSuccess: () => void;
    mode?: 'attach' | 'replace';
}

export function DocumentUploadDialog({
    open,
    onClose,
    referenceId,
    referenceTitle,
    authToken,
    onSuccess,
    mode = 'attach',
}: DocumentUploadDialogProps) {
    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const MAX_FILE_SIZE_MB = 50;

    const validateFile = useCallback((f: File): string | null => {
        if (f.type !== 'application/pdf') {
            return 'Only PDF files are accepted';
        }
        if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            return `File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB`;
        }
        return null;
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setIsDragging(false);
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile) {
                const validationError = validateFile(droppedFile);
                if (validationError) {
                    setError(validationError);
                    return;
                }
                setFile(droppedFile);
                setError(null);
            }
        },
        [validateFile]
    );

    const handleFileSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const selectedFile = e.target.files?.[0];
            if (selectedFile) {
                const validationError = validateFile(selectedFile);
                if (validationError) {
                    setError(validationError);
                    return;
                }
                setFile(selectedFile);
                setError(null);
            }
        },
        [validateFile]
    );

    const handleUpload = useCallback(async () => {
        if (!file || !authToken) return;

        setIsUploading(true);
        setError(null);
        setUploadProgress('Uploading...');

        try {
            const formData = new FormData();
            formData.append('file', file);

            const endpoint =
                mode === 'replace'
                    ? `/api/library/${referenceId}/document/replace`
                    : `/api/library/${referenceId}/document`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                body: formData,
            });

            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json')
                ? await response.json()
                : response.status === 413
                    ? {
                        error:
                            'Upload is too large for the server/proxy limit. Reduce file size or increase Nginx client_max_body_size.',
                    }
                    : { error: 'Server returned a non-JSON response. Check server logs for details.' };

            if (!response.ok) {
                throw new Error(data.error || `Upload failed (HTTP ${response.status})`);
            }

            setUploadProgress('');
            setResult(data);

            // Notify parent and close after brief delay
            setTimeout(() => {
                onSuccess();
                handleReset();
            }, 1500);
        } catch (err: any) {
            setError(err.message || 'Upload failed');
            setUploadProgress('');
        } finally {
            setIsUploading(false);
        }
    }, [file, authToken, referenceId, mode, onSuccess]);

    const handleReset = useCallback(() => {
        setFile(null);
        setError(null);
        setResult(null);
        setUploadProgress('');
        setIsUploading(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    const handleClose = useCallback(() => {
        if (!isUploading) {
            handleReset();
            onClose();
        }
    }, [isUploading, handleReset, onClose]);

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                className="bg-[#1a1a2e] border border-white/10 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <div>
                        <h3 className="text-sm font-semibold text-white">
                            {mode === 'replace' ? 'Replace PDF' : 'Attach PDF'}
                        </h3>
                        <p className="text-xs text-white/50 mt-0.5 truncate max-w-[300px]">
                            {referenceTitle}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isUploading}
                        className="text-white/40 hover:text-white/80 transition-colors disabled:opacity-30"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5">
                    {result ? (
                        // Success state
                        <div className="text-center py-4">
                            <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                            <p className="text-sm text-white font-medium">
                                {result.isDuplicate ? 'PDF linked successfully' : 'PDF uploaded successfully'}
                            </p>
                            <p className="text-xs text-white/50 mt-1">
                                {result.isDuplicate
                                    ? 'This PDF was already in your library and has been linked.'
                                    : 'Text extraction is in progress...'}
                            </p>
                        </div>
                    ) : file ? (
                        // File selected state
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
                                <FileText className="h-8 w-8 text-blue-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white font-medium truncate">{file.name}</p>
                                    <p className="text-xs text-white/50 mt-0.5">
                                        {formatFileSize(file.size)}
                                    </p>
                                </div>
                                <button
                                    onClick={handleReset}
                                    disabled={isUploading}
                                    className="text-white/30 hover:text-white/60 transition-colors disabled:opacity-30"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            {error && (
                                <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                                    <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-red-400">{error}</p>
                                </div>
                            )}

                            {uploadProgress && (
                                <div className="flex items-center justify-center gap-2 py-2">
                                    <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
                                    <span className="text-xs text-blue-400">{uploadProgress}</span>
                                </div>
                            )}

                            <button
                                onClick={handleUpload}
                                disabled={isUploading}
                                className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-sm font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="h-4 w-4" />
                                        {mode === 'replace' ? 'Replace PDF' : 'Upload PDF'}
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        // Drop zone state
                        <div
                            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 cursor-pointer ${isDragging
                                    ? 'border-blue-400 bg-blue-500/10'
                                    : 'border-white/15 hover:border-white/30 hover:bg-white/5'
                                }`}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragging(true);
                            }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload
                                className={`h-8 w-8 mx-auto mb-3 transition-colors ${isDragging ? 'text-blue-400' : 'text-white/30'
                                    }`}
                            />
                            <p className="text-sm text-white/70">
                                {isDragging ? 'Drop your PDF here' : 'Drag & drop a PDF or click to browse'}
                            </p>
                            <p className="text-xs text-white/30 mt-1.5">
                                Maximum file size: {MAX_FILE_SIZE_MB}MB
                            </p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/pdf,.pdf"
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                        </div>
                    )}

                    {error && !file && (
                        <div className="flex items-start gap-2 p-3 mt-3 bg-red-500/10 rounded-lg border border-red-500/20">
                            <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-red-400">{error}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
