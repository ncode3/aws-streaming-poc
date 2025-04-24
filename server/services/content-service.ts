import { listVideos, extractMovieInfo, getSignedVideoUrl } from './s3';
import { getAllVideos as getDynamoVideos, putItem } from './dynamodb';
import { Video, VideoWithMatch, CategoryWithVideos, FeaturedContent } from '@shared/schema';

// Import CloudFront service if it's available
let getSignedStreamingUrl: (url: string) => string = (url) => url;
try {
  const cloudFrontService = require('./aws').cloudFrontService;
  if (cloudFrontService && cloudFrontService.getSignedUrl) {
    getSignedStreamingUrl = cloudFrontService.getSignedUrl;
  }
} catch (err) {
  console.warn('CloudFront service not available, using direct URLs');
}

// In-memory cache of processed videos for better performance
let videosCache: ProcessedVideo[] = [];
let lastCacheRefresh: number = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

interface ProcessedVideo {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  hlsUrl: string;
  duration: number;
  releaseYear: number;
  genre: string;
  rating: string;
  featured: boolean;
  category: string;
  createdAt: Date;
}

// Refreshes the cache if needed
async function refreshCache() {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_TTL && videosCache.length > 0) {
    return;
  }
  
  try {
    // Collect videos from both S3 and DynamoDB
    const s3Videos = await listVideos('movies/');
    const dynamoVideos = await getDynamoVideos();
    
    const processedVideos: ProcessedVideo[] = [];
    
    // Process S3 videos
    const movieMap = new Map();
    
    s3Videos.forEach(file => {
      const movieInfo = extractMovieInfo(file.key || '');
      if (!movieInfo) return;
      
      const movieId = movieInfo.id;
      if (!movieMap.has(movieId)) {
        movieMap.set(movieId, {
          id: movieId,
          title: movieInfo.title,
          genre: movieInfo.genre,
          files: []
        });
      }
      
      movieMap.get(movieId).files.push({
        type: movieInfo.fileType,
        key: file.key,
        url: file.url
      });
    });
    
    // Convert the movie map to processed videos
    for (const movie of Array.from(movieMap.values())) {
      // Find thumbnail and video files
      const thumbnailFile = movie.files.find((f: any) => f.type === 'png');
      const videoFile = movie.files.find((f: any) => f.type === 'mp4');
      
      if (videoFile) {
        const videoUrl = videoFile.key ? await getSignedVideoUrl(videoFile.key) : null;
        
        // Create a processed video object
        const processedVideo: ProcessedVideo = {
          id: movie.id,
          title: movie.title || 'Untitled',
          description: `${movie.genre} movie: ${movie.title}`,
          thumbnailUrl: thumbnailFile ? thumbnailFile.key : null, // Use key for server-side proxying
          videoUrl: videoUrl,
          hlsUrl: videoFile.key || '', // Use S3 key for direct server-side access
          duration: 120, // Default duration in seconds
          releaseYear: 2023,
          genre: movie.genre || 'Unknown',
          rating: 'PG-13',
          featured: movie.id === '1', // First movie is featured
          category: movie.genre || 'General',
          createdAt: new Date()
        };
        
        processedVideos.push(processedVideo);
        
        // Store in DynamoDB for persistence (if not already there)
        try {
          // Only try to store in DynamoDB if not in dev mode
          // For development, we'll rely on in-memory cache only
          if (process.env.NODE_ENV !== 'development') {
            await putItem('StreamingVideos', {
              id: movie.id,
              title: processedVideo.title,
              description: processedVideo.description,
              thumbnailKey: thumbnailFile?.key || '',
              videoKey: videoFile.key || '',
              genre: processedVideo.genre,
              releaseYear: processedVideo.releaseYear,
              duration: processedVideo.duration,
              rating: processedVideo.rating,
              createdAt: new Date().toISOString()
            });
          }
        } catch (err) {
          console.warn('Failed to store video in DynamoDB:', err);
          // Continue without failing - we'll use cache-only mode
        }
      }
    }
    
    // Merge with DynamoDB videos if available
    if (dynamoVideos && dynamoVideos.length > 0) {
      for (const dynamoVideo of dynamoVideos) {
        // Skip if already processed from S3
        if (processedVideos.some(v => v.id === dynamoVideo.id)) continue;
        
        // For DynamoDB videos, use the keys directly
        const videoUrl = dynamoVideo.videoKey ? 
          await getSignedVideoUrl(dynamoVideo.videoKey) : null;
          
        const processedVideo: ProcessedVideo = {
          id: dynamoVideo.id,
          title: dynamoVideo.title || 'Untitled',
          description: dynamoVideo.description || 'No description',
          thumbnailUrl: dynamoVideo.thumbnailKey || null, // Use the key directly
          videoUrl,
          hlsUrl: dynamoVideo.videoKey || '', // Use the key directly for server-side access
          duration: dynamoVideo.duration || 0,
          releaseYear: dynamoVideo.releaseYear || 2023,
          genre: dynamoVideo.genre || 'Unknown',
          rating: dynamoVideo.rating || 'PG-13',
          featured: dynamoVideo.featured || false,
          category: dynamoVideo.genre || 'General',
          createdAt: dynamoVideo.createdAt ? new Date(dynamoVideo.createdAt) : new Date()
        };
        
        processedVideos.push(processedVideo);
      }
    }
    
    // Update cache
    videosCache = processedVideos;
    lastCacheRefresh = now;
    
    console.log(`Cache refreshed with ${processedVideos.length} videos`);
  } catch (error) {
    console.error('Failed to refresh video cache:', error);
  }
}

// Get featured content for home page
export async function getFeaturedContent(userId: number): Promise<FeaturedContent> {
  await refreshCache();
  
  // Find a featured video or pick the first one
  const featuredVideo = videosCache.find(v => v.featured) || videosCache[0];
  
  if (!featuredVideo) {
    throw new Error('No videos available');
  }
  
  // Convert to Video type
  const video: Video = {
    id: parseInt(featuredVideo.id),
    title: featuredVideo.title,
    description: featuredVideo.description,
    thumbnailUrl: featuredVideo.thumbnailUrl || '',
    videoUrl: featuredVideo.videoUrl || '',
    hlsUrl: featuredVideo.hlsUrl,
    duration: featuredVideo.duration,
    releaseYear: featuredVideo.releaseYear,
    genre: featuredVideo.genre,
    rating: featuredVideo.rating,
    featured: featuredVideo.featured,
    category: featuredVideo.category,
    createdAt: featuredVideo.createdAt
  };
  
  return {
    video,
    match: 95 // Example match percentage
  };
}

// Get content categories with videos
export async function getContentCategories(userId: number): Promise<CategoryWithVideos[]> {
  await refreshCache();
  
  // Group videos by category/genre
  const categoriesMap = new Map<string, VideoWithMatch[]>();
  
  videosCache.forEach(video => {
    const category = video.category;
    if (!categoriesMap.has(category)) {
      categoriesMap.set(category, []);
    }
    
    // Convert to Video type with match %
    const videoObj: Video = {
      id: parseInt(video.id),
      title: video.title,
      description: video.description,
      thumbnailUrl: video.thumbnailUrl || '',
      videoUrl: video.videoUrl || '',
      hlsUrl: video.hlsUrl,
      duration: video.duration,
      releaseYear: video.releaseYear,
      genre: video.genre,
      rating: video.rating,
      featured: video.featured,
      category: video.category,
      createdAt: video.createdAt
    };
    
    categoriesMap.get(category)?.push({
      ...videoObj,
      match: Math.floor(Math.random() * 30) + 70 // Random match between 70-99%
    });
  });
  
  // Convert map to array of categories
  const categories: CategoryWithVideos[] = [];
  let categoryId = 1;
  
  // Convert Map entries to array to avoid MapIterator issues
  for (const [categoryName, videos] of Array.from(categoriesMap.entries())) {
    categories.push({
      id: categoryId++,
      title: categoryName,
      videos
    });
  }
  
  return categories;
}

// Get a specific video by ID
export async function getVideoById(videoId: number): Promise<Video | null> {
  await refreshCache();
  
  const video = videosCache.find(v => parseInt(v.id) === videoId);
  if (!video) return null;
  
  // Convert to Video type
  const videoObj: Video = {
    id: parseInt(video.id),
    title: video.title,
    description: video.description,
    thumbnailUrl: video.thumbnailUrl || '',
    videoUrl: video.videoUrl || '',
    hlsUrl: video.hlsUrl,
    duration: video.duration,
    releaseYear: video.releaseYear,
    genre: video.genre,
    rating: video.rating,
    featured: video.featured,
    category: video.category,
    createdAt: video.createdAt
  };
  
  return videoObj;
}

// Get recommended videos for a user
export async function getRecommendedVideos(userId: number): Promise<VideoWithMatch[]> {
  await refreshCache();
  
  // In a real app, this would use user preferences, watch history, etc.
  // For now, return all videos with a random match percentage
  const recommendedVideos: VideoWithMatch[] = videosCache.map(video => {
    const videoObj: Video = {
      id: parseInt(video.id),
      title: video.title,
      description: video.description,
      thumbnailUrl: video.thumbnailUrl || '',
      videoUrl: video.videoUrl || '',
      hlsUrl: video.hlsUrl,
      duration: video.duration,
      releaseYear: video.releaseYear,
      genre: video.genre,
      rating: video.rating,
      featured: video.featured,
      category: video.category,
      createdAt: video.createdAt
    };
    
    return {
      ...videoObj,
      match: Math.floor(Math.random() * 30) + 70 // Random match between 70-99%
    };
  });
  
  return recommendedVideos;
}

// Add a video to user's watchlist
export async function addToWatchlist(userId: number, videoId: number): Promise<any> {
  try {
    // Only try to store in DynamoDB if not in dev mode
    if (process.env.NODE_ENV !== 'development') {
      await putItem('Watchlist', {
        userId: userId.toString(),
        videoId: videoId.toString(),
        addedAt: new Date().toISOString()
      });
    }
    
    // For development, just return success
    return { success: true };
  } catch (error) {
    console.error('Failed to add to watchlist:', error);
    // Don't fail the operation in development
    if (process.env.NODE_ENV === 'development') {
      return { success: true, dev: true };
    }
    throw error;
  }
}

// Remove a video from user's watchlist
export async function removeFromWatchlist(userId: number, videoId: number): Promise<any> {
  try {
    // This is a simplified implementation
    // In a real app, we would delete the specific item from DynamoDB
    return { success: true };
  } catch (error) {
    console.error('Failed to remove from watchlist:', error);
    // Don't fail the operation in development
    if (process.env.NODE_ENV === 'development') {
      return { success: true, dev: true };
    }
    throw error;
  }
}

// Update user's watch history
export async function updateWatchHistory(userId: number, videoId: number): Promise<any> {
  try {
    // Only try to store in DynamoDB if not in dev mode
    if (process.env.NODE_ENV !== 'development') {
      await putItem('WatchHistory', {
        userId: userId.toString(),
        videoId: videoId.toString(),
        watchedAt: new Date().toISOString(),
        progress: 0 // Starting progress
      });
    }
    
    // For development, just return success
    return { success: true };
  } catch (error) {
    console.error('Failed to update watch history:', error);
    // Don't fail the operation in development
    if (process.env.NODE_ENV === 'development') {
      return { success: true, dev: true };
    }
    throw error;
  }
}

// Request a transcode job for a new video
export async function requestTranscodeJob(title: string, description: string, s3Key: string): Promise<any> {
  try {
    // In a real app, this would call MediaConvert to transcode the video
    // For now, we'll process it directly
    
    // Extract movie ID from the key or generate a new one
    const movieInfo = extractMovieInfo(s3Key);
    const id = movieInfo?.id || Math.floor(Math.random() * 10000).toString();
    
    // Cache the video info in memory immediately
    const newVideo: ProcessedVideo = {
      id,
      title,
      description,
      thumbnailUrl: null, // No thumbnail yet
      videoUrl: await getSignedVideoUrl(s3Key),
      hlsUrl: s3Key, // Use key for server-side proxying
      duration: 0, // Unknown duration
      releaseYear: 2023,
      genre: movieInfo?.genre || 'Unknown',
      rating: 'NR', // Not rated
      featured: false,
      category: movieInfo?.genre || 'Uploads',
      createdAt: new Date()
    };
    
    // Add to the cache
    videosCache.push(newVideo);
    
    // Only try to store in DynamoDB if not in dev mode
    if (process.env.NODE_ENV !== 'development') {
      await putItem('StreamingVideos', {
        id,
        title,
        description,
        thumbnailKey: '', // No thumbnail yet
        videoKey: s3Key,
        genre: movieInfo?.genre || 'Unknown',
        releaseYear: 2023,
        duration: 0, // Unknown duration
        rating: 'NR', // Not rated
        createdAt: new Date().toISOString()
      });
    }
    
    return { 
      success: true, 
      message: 'Video processed successfully',
      videoId: id
    };
  } catch (error) {
    console.error('Failed to process video:', error);
    // Don't fail the operation in development
    if (process.env.NODE_ENV === 'development') {
      return { 
        success: true, 
        dev: true,
        message: 'Video processed in development mode' 
      };
    }
    throw error;
  }
}

export default {
  getFeaturedContent,
  getContentCategories,
  getVideoById,
  getRecommendedVideos,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchHistory,
  requestTranscodeJob
};