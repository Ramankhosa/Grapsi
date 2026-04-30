// @ts-nocheck
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import Head from 'next/head';
import Link from 'next/link';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { FaArrowLeft, FaSpinner } from 'react-icons/fa';

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  // Check authentication
  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>Edit Project Details | GrantGenie</title>
        <meta name="description" content="Edit your project details" />
      </Head>

      {/* Header */}
      <header className="bg-gradient-to-r from-green-800 to-green-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Edit Project Details</h1>
              <p className="mt-1 text-green-100">
                Update your project information
              </p>
            </div>
            <Link 
              href={`/reviewer/${id}`}
              className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
            >
              <FaArrowLeft className="mr-2" />
              Back to Project
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
            {error}
          </div>
        )}

        <div className="bg-white shadow-md rounded-lg overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-200 bg-gray-50">
            <h2 className="text-xl font-medium text-gray-900">Edit Project Information</h2>
            <p className="mt-1 text-sm text-gray-600">
              Update the details for your project below.
            </p>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            <div>
              <label htmlFor="project_title" className="block text-sm font-medium text-gray-700 mb-1">
                Project Title*
              </label>
              <input
                type="text"
                id="project_title"
                name="project_title"
                value={formData.project_title}
                onChange={handleInputChange}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 ${
                  validationErrors.project_title ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Enter your project title"
              />
              {validationErrors.project_title && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.project_title}</p>
              )}
            </div>
            
            <div>
              <label htmlFor="agency_name" className="block text-sm font-medium text-gray-700 mb-1">
                Funding Agency*
              </label>
              <input
                type="text"
                id="agency_name"
                name="agency_name"
                value={formData.agency_name}
                onChange={handleInputChange}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 ${
                  validationErrors.agency_name ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Enter funding agency name"
              />
              {validationErrors.agency_name && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.agency_name}</p>
              )}
            </div>
            <div className="pt-4 flex justify-end space-x-3 border-t border-gray-200">
              <Link
                href={`/reviewer/${id}`}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 ${
                  saving ? 'opacity-75 cursor-not-allowed' : ''
                }`}
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
      </main>
    </div>
  );
} 
