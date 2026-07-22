import { z } from 'zod';
import { zodToJsonSchema } from '../utils/schema-converter.js';
import type { ToolDefinition } from '../types.js';

// Vision models with global inference profile
const VISION_MODELS = [
  'jp.anthropic.claude-opus-4-8', // Claude Opus 4.8 (default)
  'jp.anthropic.claude-opus-4-7', // Claude Opus 4.7
  'jp.anthropic.claude-opus-4-6-v1', // Claude Opus 4.6
  'jp.anthropic.claude-opus-4-5-20251101-v1:0', // Claude Opus 4.5
] as const;

const DEFAULT_VISION_MODEL = 'jp.anthropic.claude-opus-4-8';

export const imageToTextSchema = z.object({
  imagePath: z
    .string()
    .min(1)
    .describe(
      'Image path in one of the following formats:\n' +
        '1. Local file path: /absolute/path/to/image.png or ./relative/path/to/image.png\n' +
        '2. S3 URI: s3://bucket-name/path/to/image.png (recommended for S3 stored images)\n' +
        '**IMPORTANT: Do NOT use presigned URLs (https://bucket.s3.amazonaws.com/...). Use S3 URI format instead.**'
    ),
  prompt: z
    .string()
    .optional()
    .default('Describe this image in detail.')
    .describe('Analysis prompt for the image (default: describe the image)'),
  modelId: z
    .enum(VISION_MODELS)
    .optional()
    .default(DEFAULT_VISION_MODEL)
    .describe(
      'Vision model to use (global inference profile). Options: Claude Sonnet 4.5, Claude Haiku 4.5, Nova 2 Lite'
    ),
});

export const imageToTextDefinition: ToolDefinition<typeof imageToTextSchema> = {
  name: 'image_to_text',
  description:
    'Analyze images and convert them to text descriptions using Bedrock Converse API. Supports S3 URIs and local file paths. Use vision-capable models to extract text, describe content, or analyze images. Useful for OCR, image understanding, and visual content analysis.',
  zodSchema: imageToTextSchema,
  jsonSchema: zodToJsonSchema(imageToTextSchema),
};
