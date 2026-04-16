import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Search, FileText, Shield, Zap } from 'lucide-react';

interface NoveltySearchCardProps {
  onClick: () => void;
}

export default function NoveltySearchCard({ onClick }: NoveltySearchCardProps) {
  return (
    <div className="cursor-pointer" onClick={onClick}>
      <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-blue-700">
          <Search className="h-6 w-6" />
          Novelty Search
        </CardTitle>
        <CardDescription>
          Comprehensive patent novelty assessment using AI-powered prior art analysis
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-green-600" />
              <span>AI-Powered Analysis</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <span>Professional Reports</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-600" />
              <span>Guided Workflow</span>
            </div>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-purple-600" />
              <span>PQAI Integration</span>
            </div>
          </div>

          <div className="text-xs text-gray-600 space-y-1">
            <p>• Idea normalization and analysis</p>
            <p>• Initial patent screening</p>
            <p>• Detailed novelty assessment</p>
            <p>• Professional PDF report generation</p>
          </div>

          <Button className="w-full" size="sm">
            <Search className="mr-2 h-4 w-4" />
            Start Novelty Search
          </Button>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
