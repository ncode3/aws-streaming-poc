import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import { insertUserSchema, insertVideoSchema } from "@shared/schema";
import { cognitoAuth, getCognitoUser, route53Service } from "./services/aws";

// Extend the Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}
import { 
  getContentCategories, 
  getFeaturedContent, 
  getVideoById,
  getRecommendedVideos,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchHistory,
  requestTranscodeJob
} from "./services/content-service";

// Authentication middleware
const requireAuth = async (req: Request, res: Response, next: Function) => {
  try {
    // Get the authorization token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authorization token is required' });
    }
    
    const token = authHeader.split(' ')[1];
    const cognitoUser = await cognitoAuth.verifyToken(token);
    
    if (!cognitoUser) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    
    // Attach user to request object
    req.user = cognitoUser;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
};

export async function registerRoutes(app: Express): Promise<Server> {
  // API routes - all prefixed with /api
  
  // User authentication and profile routes
  app.post('/api/user/register', async (req: Request, res: Response) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      const user = await storage.createUser(userData);
      res.status(201).json(user);
    } catch (error) {
      console.error('User registration error:', error);
      res.status(400).json({ message: 'Invalid user data' });
    }
  });
  
  app.get('/api/user/profile', requireAuth, async (req: Request, res: Response) => {
    try {
      const cognitoUser = req.user;
      const user = await storage.getUserByCognitoId(cognitoUser.sub);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      res.json(user);
    } catch (error) {
      console.error('Get user profile error:', error);
      res.status(500).json({ message: 'Failed to retrieve user profile' });
    }
  });
  
  // Content browsing routes
  app.get('/api/content/featured', requireAuth, async (req: Request, res: Response) => {
    try {
      const cognitoUser = req.user;
      const user = await storage.getUserByCognitoId(cognitoUser.sub);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const featuredContent = await getFeaturedContent(user.id);
      res.json(featuredContent);
    } catch (error) {
      console.error('Get featured content error:', error);
      res.status(500).json({ message: 'Failed to retrieve featured content' });
    }
  });
  
  app.get('/api/content/categories', requireAuth, async (req: Request, res: Response) => {
    try {
      const cognitoUser = req.user;
      const user = await storage.getUserByCognitoId(cognitoUser.sub);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const categories = await getContentCategories(user.id);
      res.json(categories);
    } catch (error) {
      console.error('Get content categories error:', error);
      res.status(500).json({ message: 'Failed to retrieve content categories' });
    }
  });
  
  app.get('/api/content/video/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const videoId = parseInt(req.params.id);
      
      if (isNaN(videoId)) {
        return res.status(400).json({ message: 'Invalid video ID' });
      }
      
      const video = await getVideoById(videoId);
      
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }
      
      res.json(video);
    } catch (error) {
      console.error('Get video error:', error);
      res.status(500).json({ message: 'Failed to retrieve video' });
    }
  });
  
  app.get('/api/content/recommendations', requireAuth, async (req: Request, res: Response) => {
    try {
      const cognitoUser = req.user;
      const user = await storage.getUserByCognitoId(cognitoUser.sub);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const recommendations = await getRecommendedVideos(user.id);
      res.json(recommendations);
    } catch (error) {
      console.error('Get recommendations error:', error);
      res.status(500).json({ message: 'Failed to retrieve recommendations' });
    }
  });
  
  // User watchlist management
  app.post('/api/user/watchlist', requireAuth, async (req: Request, res: Response) => {
    try {
      const { videoId } = req.body;
      
      if (!videoId || typeof videoId !== 'number') {
        return res.status(400).json({ message: 'Valid video ID is required' });
      }
      
      const cognitoUser = req.user;
      const user = await storage.getUserByCognitoId(cognitoUser.sub);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const result = await addToWatchlist(user.id, videoId);
      res.json(result);
    } catch (error) {
      console.error('Add to watchlist error:', error);
      res.status(500).json({ message: 'Failed to add to watchlist' });
    }
  });
  
  app.delete('/api/user/watchlist/:videoId', requireAuth, async (req: Request, res: Response) => {
    try {
      const videoId = parseInt(req.params.videoId);
      
      if (isNaN(videoId)) {
        return res.status(400).json({ message: 'Invalid video ID' });
      }
      
      const cognitoUser = req.user;
      const user = await storage.getUserByCognitoId(cognitoUser.sub);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const result = await removeFromWatchlist(user.id, videoId);
      res.json(result);
    } catch (error) {
      console.error('Remove from watchlist error:', error);
      res.status(500).json({ message: 'Failed to remove from watchlist' });
    }
  });
  
  // Watch history tracking
  app.post('/api/user/watch-history', requireAuth, async (req: Request, res: Response) => {
    try {
      const { videoId } = req.body;
      
      if (!videoId || typeof videoId !== 'number') {
        return res.status(400).json({ message: 'Valid video ID is required' });
      }
      
      const cognitoUser = req.user;
      const user = await storage.getUserByCognitoId(cognitoUser.sub);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const result = await updateWatchHistory(user.id, videoId);
      res.json(result);
    } catch (error) {
      console.error('Update watch history error:', error);
      res.status(500).json({ message: 'Failed to update watch history' });
    }
  });
  
  // Video transcoding
  app.post('/api/content/transcode', requireAuth, async (req: Request, res: Response) => {
    try {
      const { title, description, s3Key } = req.body;
      
      if (!title || !description || !s3Key) {
        return res.status(400).json({ message: 'Title, description, and S3 key are required' });
      }
      
      const transcodeJob = await requestTranscodeJob(title, description, s3Key);
      res.json(transcodeJob);
    } catch (error) {
      console.error('Transcode request error:', error);
      res.status(500).json({ message: 'Failed to start transcode job' });
    }
  });
  
  // Test endpoint for S3 integration (development only)
  app.get('/api/test/s3videos', async (_req: Request, res: Response) => {
    try {
      const s3Service = await import('./services/s3');
      const videoFiles = await s3Service.listVideos('movies/');
      
      // Process the video files to extract detailed movie information
      const processedVideos = videoFiles
        .map(file => {
          const movieInfo = s3Service.extractMovieInfo(file.key || '');
          if (movieInfo) {
            return {
              ...file,
              id: movieInfo.id,
              title: movieInfo.title,
              genre: movieInfo.genre,
              type: movieInfo.fileType
            };
          }
          return null;
        })
        .filter(item => item !== null);
      
      // Group files by movie (combine thumbnail and video files)
      const movieMap = new Map();
      processedVideos.forEach(video => {
        if (!video) return;
        
        const movieId = video.id;
        if (!movieMap.has(movieId)) {
          movieMap.set(movieId, {
            id: movieId,
            title: video.title,
            genre: video.genre,
            files: []
          });
        }
        
        movieMap.get(movieId).files.push({
          type: video.type,
          key: video.key,
          url: video.url,
          size: video.size
        });
      });
      
      // Convert map to array
      const movies = Array.from(movieMap.values());
      
      res.json({ 
        videos: processedVideos,
        movies: movies
      });
    } catch (error) {
      console.error('Error listing S3 videos:', error);
      res.status(500).json({ message: 'Failed to list S3 videos', error: String(error) });
    }
  });
  
  // Test endpoint for DynamoDB integration (development only)
  app.get('/api/test/dynamodb', async (_req: Request, res: Response) => {
    try {
      const dynamodbService = await import('./services/dynamodb');
      await dynamodbService.ensureTablesExist();
      const videos = await dynamodbService.getAllVideos();
      res.json({ 
        videos, 
        tablesInfo: {
          videos: 'StreamingVideos',
          userPreferences: 'UserPreferences',
          watchHistory: 'WatchHistory',
          watchlist: 'Watchlist'
        } 
      });
    } catch (error) {
      console.error('Error testing DynamoDB:', error);
      res.status(500).json({ message: 'Failed to test DynamoDB', error: String(error) });
    }
  });
  
  // Upload sample movies to S3 bucket (development only)
  app.post('/api/test/upload-samples', async (_req: Request, res: Response) => {
    try {
      const uploadService = await import('./services/upload-service');
      const result = await uploadService.setupSampleMovieStructure();
      res.json(result);
    } catch (error) {
      console.error('Error uploading sample movies:', error);
      res.status(500).json({ message: 'Failed to upload sample movies', error: String(error) });
    }
  });
  
  // Test endpoint for content service (development only)
  app.get('/api/test/content', async (_req: Request, res: Response) => {
    try {
      // Use a dummy user ID for testing
      const userId = 1;
      
      // Get featured content
      const featured = await getFeaturedContent(userId);
      
      // Get content categories
      const categories = await getContentCategories(userId);
      
      // Get recommended videos
      const recommendations = await getRecommendedVideos(userId);
      
      res.json({
        featured,
        categories,
        recommendations
      });
    } catch (error) {
      console.error('Error testing content service:', error);
      res.status(500).json({ message: 'Failed to test content service', error: String(error) });
    }
  });

  // Stream content routes
  app.get('/api/content/stream/:key', async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      if (!key) {
        return res.status(400).json({ message: 'Content key is required' });
      }
      
      // First decode once to handle URL encoding from route param
      const decodedKey = decodeURIComponent(key);
      
      // Then decode again if needed (sometimes the key comes double-encoded)
      const finalKey = decodedKey.includes('%') ? decodeURIComponent(decodedKey) : decodedKey;
      
      // Check file extension to set the correct content type
      const s3Service = await import('./services/s3');
      const fileExtension = finalKey.split('.').pop()?.toLowerCase();
      
      let contentType = 'application/octet-stream'; // Default
      if (fileExtension === 'png') contentType = 'image/png';
      else if (fileExtension === 'jpg' || fileExtension === 'jpeg') contentType = 'image/jpeg';
      else if (fileExtension === 'mp4') contentType = 'video/mp4';
      else if (fileExtension === 'm3u8') contentType = 'application/vnd.apple.mpegurl';
      else if (fileExtension === 'ts') contentType = 'video/mp2t';
      
      // Try to use CloudFront if available
      try {
        // Import AWS services for CloudFront
        const awsServices = await import('./services/aws');
        
        if (awsServices.cloudFrontService && process.env.AWS_CLOUDFRONT_DOMAIN) {
          // For HLS content and videos, use CloudFront
          if (fileExtension === 'm3u8' || fileExtension === 'ts' || fileExtension === 'mp4') {
            const signedUrl = awsServices.cloudFrontService.getSignedUrl(finalKey);
            console.log(`Serving ${finalKey} via CloudFront`);
            
            // Don't redirect, proxy the content through our server
            const fetch = await import('node-fetch');
            const response = await fetch.default(signedUrl);
            
            // Copy the status and headers from CloudFront response
            res.status(response.status);
            
            // Set CORS headers explicitly
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
            
            const contentTypeHeader = response.headers.get('Content-Type');
            if (contentTypeHeader) {
              res.setHeader('Content-Type', contentTypeHeader as string);
            } else {
              res.setHeader('Content-Type', contentType);
            }
            
            // Pipe the response data to the client
            if (response.body) {
              response.body.pipe(res);
            } else {
              res.status(500).json({ message: 'No response body from CloudFront' });
            }
            return;
          }
        }
      } catch (cloudFrontError) {
        console.warn('CloudFront signing failed, falling back to S3:', cloudFrontError);
        // Continue with S3 fallback
      }
      
      // For videos with range requests (streaming), proxy through our server
      if ((fileExtension === 'mp4' || fileExtension === 'webm') && req.headers.range) {
        console.log(`Proxying S3 content for ranged request: ${finalKey}`);
        // Get a signed URL for direct access
        const signedUrl = await s3Service.getSignedVideoUrl(finalKey);
        
        if (!signedUrl) {
          return res.status(404).json({ message: 'Content not found' });
        }
        
        // Forward the request to S3 with the range header
        const headers = new Headers();
        headers.append('Range', req.headers.range);
        
        try {
          const fetch = await import('node-fetch');
          const response = await fetch.default(signedUrl, { headers });
          
          // Copy the status and headers from S3 response
          res.status(response.status);
          
          // Set CORS headers explicitly
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
          
          // Copy relevant headers from the S3 response
          const contentRange = response.headers.get('Content-Range');
          if (contentRange) {
            res.setHeader('Content-Range', contentRange as string);
          }
          
          const contentLength = response.headers.get('Content-Length');
          if (contentLength) {
            res.setHeader('Content-Length', contentLength as string);
          }
          
          const contentTypeHeader = response.headers.get('Content-Type');
          if (contentTypeHeader) {
            res.setHeader('Content-Type', contentTypeHeader as string);
          } else {
            res.setHeader('Content-Type', contentType);
          }
          res.setHeader('Accept-Ranges', 'bytes');
          
          // Pipe the response data to the client
          if (response.body) {
            response.body.pipe(res);
          } else {
            res.status(500).json({ message: 'No response body from S3' });
          }
          return;
        } catch (error) {
          console.error('Error proxying video from S3:', error);
          res.status(500).json({ message: 'Error streaming video content' });
          return;
        }
      }
      
      // For standard requests, get a signed URL and proxy
      console.log(`Proxying S3 content for ${finalKey}`);
      const signedUrl = await s3Service.getSignedVideoUrl(finalKey);
      
      if (!signedUrl) {
        return res.status(404).json({ message: 'Content not found' });
      }
      
      try {
        const fetch = await import('node-fetch');
        const response = await fetch.default(signedUrl);
        
        // If response is not OK, return error
        if (!response.ok) {
          console.error(`S3 returned status ${response.status} for ${finalKey}`);
          return res.status(response.status).json({ 
            message: `S3 returned status ${response.status}`,
            details: await response.text() 
          });
        }
        
        // Copy the status and headers from S3 response
        res.status(response.status);
        
        // Set CORS headers explicitly
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
        
        // Copy relevant headers from the S3 response
        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
          res.setHeader('Content-Length', contentLength as string);
        }
        
        const contentTypeHeader = response.headers.get('Content-Type');
        if (contentTypeHeader) {
          res.setHeader('Content-Type', contentTypeHeader as string);
        } else {
          res.setHeader('Content-Type', contentType);
        }
        
        // Add caching headers
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        // Pipe the response data to the client
        if (response.body) {
          response.body.pipe(res);
        } else {
          res.status(500).json({ message: 'No response body from S3' });
        }
      } catch (error) {
        console.error('Error proxying content from S3:', error);
        res.status(500).json({ message: 'Error streaming content', error: String(error) });
      }
    } catch (error) {
      console.error('Error streaming content:', error);
      res.status(500).json({ message: 'Failed to stream content', error: String(error) });
    }
  });

  // Domain management routes
  
  // Check domain availability
  app.get('/api/domains/check/:domainName', requireAuth, async (req: Request, res: Response) => {
    try {
      const { domainName } = req.params;
      
      if (!domainName) {
        return res.status(400).json({ message: 'Domain name is required' });
      }
      
      const availability = await route53Service.checkDomainAvailability(domainName);
      res.json(availability);
    } catch (error) {
      console.error('Domain availability check error:', error);
      res.status(500).json({ message: 'Failed to check domain availability' });
    }
  });
  
  // Get domain suggestions
  app.get('/api/domains/suggestions/:keyword', requireAuth, async (req: Request, res: Response) => {
    try {
      const { keyword } = req.params;
      const { limit } = req.query;
      
      if (!keyword) {
        return res.status(400).json({ message: 'Keyword is required' });
      }
      
      const maxSuggestions = limit ? parseInt(limit as string) : 5;
      const suggestions = await route53Service.getDomainSuggestions(keyword, maxSuggestions);
      res.json(suggestions);
    } catch (error) {
      console.error('Domain suggestions error:', error);
      res.status(500).json({ message: 'Failed to get domain suggestions' });
    }
  });
  
  // Register a domain
  app.post('/api/domains/register', requireAuth, async (req: Request, res: Response) => {
    try {
      const { domainName, contactInfo, autoRenew, durationInYears } = req.body;
      
      if (!domainName || !contactInfo) {
        return res.status(400).json({ message: 'Domain name and contact information are required' });
      }
      
      // First check if the domain is available
      const availability = await route53Service.checkDomainAvailability(domainName);
      
      if (availability.Availability !== 'AVAILABLE') {
        return res.status(400).json({ 
          message: 'Domain is not available for registration',
          status: availability.Availability 
        });
      }
      
      // Register the domain
      const registrationResult = await route53Service.registerDomain(
        domainName,
        contactInfo,
        autoRenew !== undefined ? autoRenew : true,
        durationInYears || 1
      );
      
      // Create a hosted zone for the domain
      const hostedZoneResult = await route53Service.createHostedZone(domainName);
      
      res.json({
        registration: registrationResult,
        hostedZone: hostedZoneResult,
      });
    } catch (error) {
      console.error('Domain registration error:', error);
      res.status(500).json({ message: 'Failed to register domain' });
    }
  });
  
  // Get all registered domains
  app.get('/api/domains/registered', requireAuth, async (req: Request, res: Response) => {
    try {
      const domains = await route53Service.getRegisteredDomains();
      res.json(domains);
    } catch (error) {
      console.error('Get registered domains error:', error);
      res.status(500).json({ message: 'Failed to get registered domains' });
    }
  });
  
  // Get all hosted zones
  app.get('/api/domains/hosted-zones', requireAuth, async (req: Request, res: Response) => {
    try {
      const hostedZones = await route53Service.getHostedZones();
      res.json(hostedZones);
    } catch (error) {
      console.error('Get hosted zones error:', error);
      res.status(500).json({ message: 'Failed to get hosted zones' });
    }
  });
  
  // Create DNS record for a domain
  app.post('/api/domains/dns-record', requireAuth, async (req: Request, res: Response) => {
    try {
      const { hostedZoneId, recordName, recordType, recordValue, ttl } = req.body;
      
      if (!hostedZoneId || !recordName || !recordType || !recordValue) {
        return res.status(400).json({ 
          message: 'Hosted zone ID, record name, record type, and record value are required' 
        });
      }
      
      const result = await route53Service.createDnsRecord(
        hostedZoneId,
        recordName,
        recordType,
        recordValue,
        ttl || 300
      );
      
      res.json(result);
    } catch (error) {
      console.error('Create DNS record error:', error);
      res.status(500).json({ message: 'Failed to create DNS record' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
