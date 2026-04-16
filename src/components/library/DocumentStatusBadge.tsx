'use client';

import React from 'react';
import { Loader2, AlertCircle, Upload, CheckCircle } from 'lucide-react';

interface DocumentStatusBadgeProps {
    status: 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED';
    errorCode?: string | null;
    filename?: string;
    fileSizeBytes?: number;
    mimeType?: string | null;
    sourceType?: 'UPLOAD' | 'DOI_FETCH' | 'URL_IMPORT' | 'TEXT_PASTE' | string | null;
    compact?: boolean;
}

const STATUS_CONFIG = {
    UPLOADED: {
        label: 'Processing...',
        color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        icon: Upload,
        animate: false,
    },
    PARSING: {
        label: 'Extracting text...',
        color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        icon: Loader2,
        animate: true,
    },
    READY: {
        label: 'PDF Ready',
        color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        icon: CheckCircle,
        animate: false,
    },
    FAILED: {
        label: 'Processing failed',
        color: 'bg-red-500/10 text-red-400 border-red-500/20',
        icon: AlertCircle,
        animate: false,
    },
};

const ERROR_MESSAGES: Record<string, string> = {
    password_protected: 'Password-protected PDF',
    corrupted: 'Corrupted PDF',
    scanned_only: 'Scanned PDF (no text)',
    unsupported: 'Unsupported format',
    file_not_found: 'File missing',
    parse_error: 'Text extraction failed',
};

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentStatusBadge({
    status,
    errorCode,
    filename,
    fileSizeBytes,
    mimeType,
    sourceType,
    compact = false,
}: DocumentStatusBadgeProps) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.UPLOADED;
    const Icon = config.icon;
    const normalizedMimeType = String(mimeType || '').toLowerCase();
    const isPdfDocument = normalizedMimeType.includes('pdf');
    const isTextDocument = normalizedMimeType.startsWith('text/') || sourceType === 'TEXT_PASTE';
    const failedButViewablePdf = status === 'FAILED' && errorCode === 'parse_error' && isPdfDocument;
    const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] || errorCode : null;
    const resolvedLabel = status === 'READY'
        ? (isTextDocument && !isPdfDocument ? 'Text Ready' : 'PDF Ready')
        : (status === 'FAILED' && failedButViewablePdf
            ? 'PDF available (text extraction failed)'
            : (status === 'FAILED' && errorMessage ? errorMessage : config.label));
    const resolvedColor = failedButViewablePdf
        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        : config.color;

    if (compact) {
        return (
            <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${resolvedColor}`}
                title={resolvedLabel}
            >
                <Icon className={`h-3 w-3 ${config.animate ? 'animate-spin' : ''}`} />
                {status === 'READY' ? (isPdfDocument ? 'PDF' : 'TXT') : status === 'FAILED' ? '!' : '...'}
            </span>
        );
    }

    return (
        <div
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border ${resolvedColor}`}
            title={filename || ''}
        >
            <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${config.animate ? 'animate-spin' : ''}`} />
            <span className="truncate max-w-[120px]">
                {resolvedLabel}
            </span>
            {fileSizeBytes && status === 'READY' && (
                <span className="text-[10px] opacity-60 ml-0.5">
                    ({formatFileSize(fileSizeBytes)})
                </span>
            )}
        </div>
    );
}
