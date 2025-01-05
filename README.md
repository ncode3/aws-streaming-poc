# Netflix-like Streaming Platform PoC

## Overview
- **AWS Services**: Cognito (Auth), S3 (Storage), CloudFront (CDN), MediaConvert (Transcoding), DynamoDB (Metadata), Lambda, API Gateway.
- **Features**:
  - User login/registration via Cognito.
  - Video transcoding via MediaConvert, outputs in HLS or CMAF.
  - CloudFront for secure, low-latency video distribution.
  - DynamoDB for content metadata, recommendations stubs.
  - IAM roles & policies for least-privilege access.

## Key Steps Completed
1. **Infrastructure**:
   - S3 buckets (video storage, logs).
   - CloudFront distribution w/ OAC.
   - MediaConvert job to generate .m3u8 or .cmfv segments.

2. **Backend**:
   - Cognito user pools for auth.
   - Lambda functions (auth-handler, content-handler, recommendation-handler).
   - API Gateway routes to each function.
   - IAM policies granting minimal S3, DynamoDB, or SageMaker access.

3. **Security**:
   - Bucket policies (restrict public access, allow only CloudFront or MediaConvert).
   - Cognito integration for JWT-based auth on certain endpoints.

4. **Transcoding**:
   - Custom or system presets (depending on region).
   - CMAF / Apple HLS output for adaptive streaming.

5. **Next Steps**:
   - Embed video player (e.g., Video.js) pointing to your CloudFront .m3u8 or .mpd URL.
   - Integrate front-end login flow with Cognito tokens.
   - Finish user-based recommendations or analytics (DynamoDB + QuickSight).

## Usage
- **Upload** your `index.html` or front-end code to S3 for hosting.
- **Update** the CloudFront distribution to point to that S3 bucket.
- **Ensure** MediaConvert roles & policies are correct to transcode videos into your target S3 folder.

EOF

# 2) Commit & push to GitHub
git add README.md
git commit -m "Add Netflix-like streaming PoC overview"
git push
# aws-streaming-poc
