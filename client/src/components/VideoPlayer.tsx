import { useEffect, useRef, useState } from 'react';
import { Video } from '@shared/schema';
import { VideoPlayer as Player } from '@/components/ui/video-player';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface VideoPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  video: Video;
}

export default function VideoPlayer({ isOpen, onClose, video }: VideoPlayerProps) {
  const playerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [useSimplePlayer, setUseSimplePlayer] = useState(false);
  
  // Handle escape key to close player
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent scrolling on body when modal is open
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
  // Construct direct API URL
  const directApiUrl = `/api/content/stream/${encodeURIComponent(video.hlsUrl)}`;
  
  return (
    <div 
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 z-10">
        <Button 
          variant="secondary"
          size="icon" 
          className="bg-[#333]/70 hover:bg-[#333] w-10 h-10 rounded-full" 
          onClick={onClose}
        >
          <X className="h-6 w-6" />
        </Button>
      </div>
      
      <div 
        ref={playerRef}
        className="w-full h-full max-w-screen-lg relative"
        onClick={(e) => e.stopPropagation()}
      >
        {useSimplePlayer ? (
          // Fallback to a simple HTML5 video player
          <div className="w-full h-full flex items-center justify-center bg-black">
            <video
              src={directApiUrl}
              poster={video.thumbnailUrl}
              controls
              autoPlay
              className="max-h-full max-w-full"
              onError={() => {
                console.error('Simple video player failed too');
                toast({ 
                  title: 'Video playback error',
                  description: 'Unable to play this video. The format may not be supported by your browser.',
                  variant: 'destructive'
                });
              }}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        ) : (
          // Try the enhanced video player first
          <Player
            src={video.videoUrl}
            title={video.title}
            poster={video.thumbnailUrl}
            fallbackSrc={directApiUrl}
            autoplay={true}
            onError={(err) => {
              console.error('Enhanced video player failed, trying simple player');
              console.error('Video URL that failed:', video.videoUrl);
              console.error('Fallback URL that failed:', directApiUrl);
              
              // Switch to simple player as a last resort
              setUseSimplePlayer(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
