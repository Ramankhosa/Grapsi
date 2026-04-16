'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FolderOpen, Plus, Check } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  createdAt: string;
  patents?: { id: string }[];
  collaborators?: { id: string }[];
}

interface ProjectSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProject: (projectId: string | null) => void;
  title: string;
  description: string;
  actionType: 'draft' | 'novelty-search';
}

const DEFAULT_PROJECT = {
  id: 'default',
  name: 'Default Project',
  description: 'Quick drafts and searches without project organization',
  isDefault: true
};

export default function ProjectSelectorModal({
  isOpen,
  onClose,
  onSelectProject,
  title,
  description,
  actionType
}: ProjectSelectorModalProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchProjects();
    }
  }, [isOpen]);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectProject = (projectId: string | null) => {
    setSelectedProjectId(projectId);
  };

  const handleConfirm = () => {
    onSelectProject(selectedProjectId);
    onClose();
  };

  const getActionIcon = () => {
    return actionType === 'draft' ? '📝' : '🔍';
  };

  const getActionColor = () => {
    return actionType === 'draft' ? 'indigo' : 'purple';
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-white border-gray-200 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{getActionIcon()}</span>
            {title}
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Default Project Option */}
          <Card
            className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
              selectedProjectId === 'default'
                ? `ring-2 ring-${getActionColor()}-500 bg-${getActionColor()}-50`
                : 'hover:bg-gray-50'
            }`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => handleSelectProject('default')}>
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 bg-gradient-to-r from-${getActionColor()}-500 to-${getActionColor()}-600 rounded-full flex items-center justify-center`}>
                    <FolderOpen className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      {DEFAULT_PROJECT.name}
                      <Badge variant="secondary" className="text-xs">Default</Badge>
                    </h3>
                    <p className="text-sm text-gray-600">{DEFAULT_PROJECT.description}</p>
                  </div>
                </div>
                {selectedProjectId === 'default' && (
                  <Check className={`w-5 h-5 text-${getActionColor()}-600`} />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Existing Projects */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-3">
              Or select an existing project:
            </h4>

            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-600 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-2">Loading projects...</p>
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                <FolderOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-sm text-gray-500 mb-4">No projects yet</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.href = '/dashboard'}
                  className="text-xs"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Create your first project
                </Button>
              </div>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {projects.map((project) => (
                  <Card
                    key={project.id}
                    className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
                      selectedProjectId === project.id
                        ? `ring-2 ring-${getActionColor()}-500 bg-${getActionColor()}-50`
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between cursor-pointer" onClick={() => handleSelectProject(project.id)}>
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 bg-gradient-to-r from-${getActionColor()}-100 to-${getActionColor()}-200 rounded-full flex items-center justify-center`}>
                            <FolderOpen className={`w-5 h-5 text-${getActionColor()}-600`} />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{project.name}</h3>
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                              {project.patents && (
                                <span>{project.patents.length} patent{project.patents.length !== 1 ? 's' : ''}</span>
                              )}
                              {project.collaborators && project.collaborators.length > 0 && (
                                <span>{project.collaborators.length} collaborator{project.collaborators.length !== 1 ? 's' : ''}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {selectedProjectId === project.id && (
                          <Check className={`w-5 h-5 text-${getActionColor()}-600`} />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedProjectId === null}
            className={`bg-${getActionColor()}-600 hover:bg-${getActionColor()}-700`}
          >
            {actionType === 'draft' ? 'Start Drafting' : 'Start Analysis'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
