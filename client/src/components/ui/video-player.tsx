import { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

// Define props interface
interface VideoPlayerProps {
  src: string;
  title?: string;
  poster?: string;
  width?: string | number;
  height?: string | number;
  controls?: boolean;
  autoplay?: boolean;
  className?: string;
  fallbackSrc?: string;
  onReady?: () => void;
  onError?: (error: any) => void;
}

export function VideoPlayer({
  src,
  title,
  poster,
  width = '100%',
  height = '100%',
  controls = true,
  autoplay = false,
  className = '',
  fallbackSrc,
  onReady,
  onError,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isError, setIsError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [attemptedFallback, setAttemptedFallback] = useState(false);
  
  // Determine the video type based on URL or extension
  const getVideoType = (url: string) => {
    if (!url) return 'video/mp4';
    
    // Extract extension from URL
    const extension = url.split('?')[0].split('.').pop()?.toLowerCase();
    
    // Known extensions
    if (extension === 'm3u8') return 'application/x-mpegURL';
    if (extension === 'mp4') return 'video/mp4';
    if (extension === 'webm') return 'video/webm';
    if (extension === 'ogv') return 'video/ogg';
    
    // For URLs without clear extensions, use URL patterns
    if (url.includes('.m3u8')) return 'application/x-mpegURL';
    if (url.includes('.mp4')) return 'video/mp4';
    if (url.includes('.webm')) return 'video/webm';
    if (url.includes('.ogv')) return 'video/ogg';
    
    // API endpoints likely return MP4
    if (url.includes('/api/content/stream/')) return 'video/mp4';
    
    // Default to mp4 if no extension is found
    return 'video/mp4';
  };

  useEffect(() => {
    // Reset error state when src changes
    setIsError(false);
    setCurrentSrc(src);
  }, [src]);

  useEffect(() => {
    // Make sure Video.js player is only initialized once
    if (!playerRef.current && videoRef.current) {
      // Initialize Video.js player
      const videoElement = document.createElement('video-js');
      videoElement.classList.add('vjs-big-play-centered', 'vjs-netflix-skin');
      videoRef.current.appendChild(videoElement);

      const playerOptions = {
        autoplay,
        controls,
        responsive: true,
        fluid: true,
        poster,
        playbackRates: [0.5, 1, 1.5, 2],
        html5: {
          vhs: {
            overrideNative: true,
          },
          nativeAudioTracks: false,
          nativeVideoTracks: false,
        },
        sources: [
          {
            src: currentSrc,
            type: getVideoType(currentSrc),
          },
        ],
      };

      playerRef.current = videojs(videoElement, playerOptions, () => {
        // Player is ready
        console.log('Player is ready, src:', currentSrc);
        console.log('Player type:', getVideoType(currentSrc));
        if (onReady) onReady();
        
        // Add error handling
        playerRef.current.on('error', (error: any) => {
          console.error('Video player error:', error);
          console.error('Error details:', playerRef.current.error());
          
          // Try fallback source if available
          if (fallbackSrc && fallbackSrc !== currentSrc) {
            console.log('Trying fallback source:', fallbackSrc);
            console.log('Fallback type:', getVideoType(fallbackSrc));
            
            // Use a clean approach - destroy and recreate the player
            if (playerRef.current) {
              // Save the control status
              const wasPlaying = !playerRef.current.paused();
              
              // Clean up
              playerRef.current.pause();
              playerRef.current.src('');
              
              // Set the new source
              setCurrentSrc(fallbackSrc);
              playerRef.current.src({
                src: fallbackSrc,
                type: getVideoType(fallbackSrc)
              });
              
              // Load and play if it was playing before
              playerRef.current.load();
              
              if (wasPlaying || autoplay) {
                setTimeout(() => {
                  try {
                    const playPromise = playerRef.current.play();
                    if (playPromise !== undefined) {
                      playPromise.catch((e: any) => {
                        console.error('Failed to play fallback source:', e);
                        setIsError(true);
                        if (onError) onError(e);
                      });
                    }
                  } catch (e) {
                    console.error('Error during playback:', e);
                    setIsError(true);
                    if (onError) onError(e);
                  }
                }, 500);
              }
            }
          } else {
            setIsError(true);
            if (onError) onError(error);
          }
        });
      });
    } else if (playerRef.current) {
      // Update player source if it changes
      playerRef.current.src({
        src: currentSrc,
        type: getVideoType(currentSrc),
      });
      
      if (poster) {
        playerRef.current.poster(poster);
      }
      
      // Attempt to play
      if (autoplay) {
        playerRef.current.play().catch((e: any) => {
          console.error('Failed to autoplay:', e);
        });
      }
    }
    
  }, [currentSrc, poster, autoplay, controls, fallbackSrc, onReady, onError]);
  
  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  // Handle direct fallback if videojs fails
  useEffect(() => {
    if (isError && fallbackSrc && videoRef.current) {
      // If we already tried the videojs fallback and it failed, try a direct HTML5 video element
      if (attemptedFallback) {
        console.log('Creating direct HTML5 video element as last resort');
        
        // Clear the videojs container
        if (videoRef.current) {
          videoRef.current.innerHTML = '';
          
          // Create a direct HTML5 video element
          const directVideoElement = document.createElement('video');
          directVideoElement.src = fallbackSrc;
          directVideoElement.controls = true;
          directVideoElement.autoplay = true;
          directVideoElement.style.width = '100%';
          directVideoElement.style.height = '100%';
          directVideoElement.style.objectFit = 'contain';
          directVideoElement.poster = poster || '';
          directVideoElement.className = 'w-full h-full';
          
          // Add it to the DOM
          videoRef.current.appendChild(directVideoElement);
          
          // Reset error state
          setIsError(false);
        }
      } else {
        // Mark that we attempted the videojs fallback
        setAttemptedFallback(true);
      }
    }
  }, [isError, fallbackSrc, attemptedFallback, poster]);
  
  return (
    <div data-vjs-player className="relative">
      <div 
        ref={videoRef} 
        className={`video-js vjs-big-play-centered vjs-netflix-skin ${className}`}
        style={{ width, height }}
      />
      {title && (
        <div className="video-title absolute top-4 left-4 text-white font-bold text-xl z-30 transition-opacity duration-300">
          {title}
        </div>
      )}
      {isError && (!fallbackSrc || attemptedFallback) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 z-40">
          <div className="text-white text-center p-4">
            <p className="mb-2">Unable to play this video.</p>
            <p className="text-sm">The video may be unavailable or in an unsupported format.</p>
          </div>
        </div>
      )}
    </div>
  );
}
