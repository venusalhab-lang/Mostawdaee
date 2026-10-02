import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className = '', ...props }: SkeletonProps) {
  return (
    <div 
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded-md ${className}`}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-[2rem] border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
      <div className="flex justify-between items-start">
        <Skeleton className="w-12 h-12 rounded-2xl" />
        <Skeleton className="w-20 h-6 rounded-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="w-3/4 h-6" />
        <Skeleton className="w-1/2 h-4" />
      </div>
      <div className="grid grid-cols-2 gap-4 pt-4">
        <Skeleton className="h-10 rounded-xl" />
        <Skeleton className="h-10 rounded-xl" />
      </div>
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <tr className="animate-pulse">
      <td className="px-6 py-4"><Skeleton className="h-10 w-full" /></td>
      <td className="px-6 py-4"><Skeleton className="h-6 w-24" /></td>
      <td className="px-6 py-4"><Skeleton className="h-6 w-16" /></td>
      <td className="px-6 py-4"><Skeleton className="h-6 w-20" /></td>
      <td className="px-6 py-4"><Skeleton className="h-6 w-20" /></td>
      <td className="px-6 py-4"><Skeleton className="h-8 w-8 rounded-lg" /></td>
    </tr>
  );
}
