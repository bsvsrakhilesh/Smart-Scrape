import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'rectangular';
}

const Skeleton: React.FC<SkeletonProps> = ({ className = '', variant = 'rectangular' }) => {
  const baseClasses = 'animate-pulse bg-muted rounded';
  const classes = variant === 'text' 
    ? `${baseClasses} h-4 w-1/3` 
    : `${baseClasses} ${className}`;

  return <div className={classes} />;
};

export default Skeleton;
