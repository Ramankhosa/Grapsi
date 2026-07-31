// @ts-nocheck
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import Head from 'next/head';
import Link from 'next/link';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { FaSpinner } from 'react-icons/fa';
import ReviewerShell from '@/components/reviewer/ReviewerShell';

// Define types
interface FormData {
  project_title: string;
  agency_name: string;
}

interface ValidationErrors {
  project_title?: string;
  agency_name?: string;
}

export default function EditProjectDetails() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<FormData>({
    project_title: '',
    agency_name: '',
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  // Fetch project details
  useEffect(() => {
    const fetchProjectDetails = async () => {
      if (!id || status !== 'authenticated') return;

      try {
        setLoading(true);
        const response = await axios.get(`/api/reviewer/calls/${id}`);
        const { call } = response.data;
        
        setFormData({
          project_title: call.project_title || '',
          agency_name: call.agency_name || '',
        });
      } catch (err) {
        console.error('Failed to fetch project details:', err);
        setError('Failed to load project details. Please try again later.');
        
        // Redirect if unauthorized
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          router.push('/login');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProjectDetails();
  }, [id, status, router]);

  // Handle input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear validation error for this field
    if (validationErrors[name as keyof ValidationErrors]) {
      setValidationErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  // Form validation
  const validateForm = () => {
    const errors: ValidationErrors = {};
    
    if (!formData.project_title.trim()) {
      errors.project_title = 'Project title is required';
    }
    
    if (!formData.agency_name.trim()) {
      errors.agency_name = 'Agency name is required';
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setSaving(true);
    setError('');
    
    try {
      const response = await axios.put(`/api/reviewer/calls/${id}`, formData);
      
      if (response.status === 200) {
        toast.success('Project details updated successfully');
        router.push(`/reviewer/${id}`);
      }
    } catch (err) {
      console.error('Failed to update project details:', err);
      setError('Failed to update project details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Loading state
  if (status === 'loading' || loading) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="h-40 w-full max-w-[880px] animate-pulse rounded-xl bg-nickel-100" />
      </div>
    );
  }
  
  // Check authentication
  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }

  return (
    <ReviewerShell
      call={{ id, project_title: formData.project_title }}
      title="Workspace settings"
      showRail={false}
    >
      <div className="mx-auto max-w-[880px]">
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700"
          >
            {error}
          </div>
        )}

        <div className="nk-panel overflow-hidden">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Project details</h2>
              <p className="nk-sub mt-0.5">How this workspace is labelled.</p>
            </div>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            <div>
              <label htmlFor="project_title" className="nk-label mb-1.5">
                Project Title*
              </label>
              <input
                type="text"
                id="project_title"
                name="project_title"
                value={formData.project_title}
                onChange={handleInputChange}
                className={`nk-input ${validationErrors.project_title ? 'border-red-300' : ''}`}
                placeholder="Enter your project title"
              />
              {validationErrors.project_title && (
                <p className="mt-1.5 text-[12.5px] text-red-600">{validationErrors.project_title}</p>
              )}
            </div>
            
            <div>
              <label htmlFor="agency_name" className="nk-label mb-1.5">
                Funding Agency*
              </label>
              <input
                type="text"
                id="agency_name"
                name="agency_name"
                value={formData.agency_name}
                onChange={handleInputChange}
                className={`nk-input ${validationErrors.agency_name ? 'border-red-300' : ''}`}
                placeholder="Enter funding agency name"
              />
              {validationErrors.agency_name && (
                <p className="mt-1.5 text-[12.5px] text-red-600">{validationErrors.agency_name}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-nickel-200 pt-5">
              <Link
                href={`/reviewer/${id}`}
                className="nk-btn-secondary nk-btn-sm"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="nk-btn-primary nk-btn-sm"
              >
                {saving ? (
                  <span className="flex items-center">
                    <FaSpinner className="animate-spin mr-2" />
                    Saving...
                  </span>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ReviewerShell>
  );
}
