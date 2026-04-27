# Archive Processing and Website Creation

## Overview

Beesnap provides advanced archive processing capabilities that automatically convert uploaded folders, ZIP files, and TAR files into browsable websites with professional index pages. This system intelligently handles file organization, metadata cleanup, and website configuration.

## Supported Upload Types

### 1. Folder Upload

- **What**: Upload entire directories from your computer
- **Result**: TAR archive with auto-generated website index
- **Best for**: Project sharing, document collections, media galleries

### 2. ZIP File Upload

- **What**: Upload ZIP archives with automatic extraction
- **Result**: Extracted files as TAR with website index
- **Best for**: Compressed archives, website backups, file collections

### 3. TAR File Upload

- **What**: Upload existing TAR files with enhancement
- **Result**: Enhanced TAR with added index if missing
- **Best for**: Existing archives, Unix/Linux file collections

## Automatic Website Creation

### Index Generation System

All archive uploads automatically become browsable websites:

```
Upload Type → Process → Add Index (if missing) → Website Ready
```

#### When Index is Auto-Generated

The system creates `index.html` when:

- No `index.html` or `index.htm` exists in the archive
- Upload contains multiple files that benefit from navigation
- Archive is processed for web serving (automatic for folders/uncompressed files)

#### Generated Index Features

**Professional Branding**:

- Swarm black theme with orange accent colors
- Responsive design for all device sizes
- Clean typography and modern CSS Grid layout
- Branded footer linking to ethswarm.org

**File Navigation**:

- Complete alphabetical file listing
- Clickable links to each file
- File type icons for visual identification
- Links open in new tabs for better UX
- Folder structure clearly displayed

**Content Organization**:

```html
📁 Archive Name X files available 📄 document1.pdf 📄 document2.txt 📄 image1.jpg 📄
subfolder/file.html 📄 another-file.zip Powered by Swarm ↗
```

## Smart File Processing

### System Metadata Filtering

Automatically removes system files across all upload types:

#### macOS Cleanup

- **PAX Headers**: `PaxHeader/` directories and contents
- **Resource Forks**: `__MACOSX/` folders and all nested files
- **Finder Metadata**: `.DS_Store` files throughout structure
- **Resource Files**: `._filename` files

#### Windows Cleanup

- **Thumbnail Cache**: `Thumbs.db` files
- **System Attributes**: Windows-specific metadata files

#### Cross-Platform Benefits

- **Clean Results**: No system clutter in file listings
- **Smaller Archives**: Significantly reduced upload sizes
- **Professional Appearance**: Only content files visible
- **Consistent Behavior**: Same experience across all operating systems

### Filename Compatibility

#### TAR Format Requirements

TAR has a strict 100-character filename limit. The system handles this automatically:

**Smart Truncation Algorithm**:

1. Check if filename exceeds 100 characters
2. Preserve file extension for proper handling
3. Preserve directory structure
4. Truncate filename and add unique hash
5. Ensure no filename collisions

**Example**:

```
❌ Too Long (135 chars):
my-very-long-project-name-with-detailed-description-and-version-information-that-exceeds-tar-limits-final-v2.1.3.zip

✅ Auto-Fixed (≤100 chars):
my-very-long-project-name-with-detailed-description-and-version-information-that-exceed_a1b2c3d4.zip
```

## Processing Workflows

### Folder Upload Workflow

```
1. Select Folder
   ↓
2. Browser Permission (normal security)
   ↓
3. Scan Folder Structure
   ↓
4. Filter System Files
   ↓
5. Check for Existing Index
   ↓
6. Generate Index (if needed)
   ↓
7. Create TAR Archive
   ↓
8. Upload as Website
   ↓
9. Browsable Archive Ready
```

### ZIP Upload Workflow

```
1. Select ZIP File
   ↓
2. Choose Compression Option
   ├─ Compressed → Upload as-is
   └─ Uncompressed ↓
3. Extract ZIP Contents
   ↓
4. Filter System Files
   ↓
5. Check for Existing Index
   ↓
6. Generate Index (if needed)
   ↓
7. Convert to TAR Format
   ↓
8. Upload as Website
   ↓
9. Browsable Archive Ready
```

### TAR Upload Workflow

```
1. Select TAR File
   ↓
2. Extract TAR Contents
   ↓
3. Filter System Files
   ↓
4. Check for Existing Index
   ↓
5. Generate Index (if needed)
   ↓
6. Re-package TAR
   ↓
7. Upload as Website
   ↓
8. Enhanced Archive Ready
```

## Website Configuration

### Automatic Web Server Setup

When archives are processed as websites, the system configures:

#### HTTP Headers

- `Swarm-Index-Document: index.html` - Sets default page
- `Swarm-Error-Document: error.html` - Custom error handling
- Proper MIME types for all file formats

#### URL Structure

```
https://bzz.link/bzz/REFERENCE/           → index.html (auto-generated or existing)
https://bzz.link/bzz/REFERENCE/file.pdf   → Direct file access
https://bzz.link/bzz/REFERENCE/folder/    → Folder contents
https://bzz.link/bzz/REFERENCE/404        → error.html (if exists)
```

### Directory Browsing

Root URL always shows:

- Generated index page with complete file listing
- Professional branding and navigation
- Responsive design for all devices
- Direct access links to all files

## Upload History and Persistence

### Browser Storage

**Upload History**:

- Stored in browser's local storage
- Cleared when browser cache is cleared
- Can be manually exported/imported
- Does not sync between browsers/devices

### Wallet-Based Persistence

**Storage Stamps**:

- Linked to wallet address, not browser
- Automatically available when wallet connects
- Persist across browsers and devices
- No manual migration needed

**Key Difference**:

```
Upload History: Browser-dependent, requires manual backup
Storage Stamps: Wallet-dependent, automatically portable
```

## Performance Optimizations

### Memory Management

- **Streaming Processing**: Large files processed without loading entirely into memory
- **Intelligent Chunking**: Files processed in optimal batch sizes
- **Browser Stability**: Optimized to prevent crashes with large archives
- **Progress Tracking**: Real-time updates for long-running operations

### Network Efficiency

- **Single Upload**: Multiple files packaged into one TAR for faster transfer
- **Compression**: Efficient TAR creation with optimal compression
- **Retry Logic**: Automatic retry for network-related failures
- **Timeout Handling**: Extended timeouts for large file processing

### File System Optimization

- **Parallel Processing**: Multiple files can be processed simultaneously
- **Deduplication**: Intelligent handling of duplicate files
- **Path Normalization**: Clean, consistent file paths
- **Error Recovery**: Continues processing even if some files fail

## Use Cases and Examples

### Document Management

**Academic Research Project**:

```
research-project/
├── papers/
│   ├── literature-review.pdf
│   ├── methodology.pdf
│   └── results.pdf
├── data/
│   ├── survey-results.xlsx
│   └── analysis.csv
├── presentations/
│   └── defense-slides.pptx
└── README.md
```

**Result**: Professional website with organized document access

### Web Development

**Frontend Project**:

```
my-website/
├── index.html (existing)
├── css/
│   ├── main.css
│   └── responsive.css
├── js/
│   ├── app.js
│   └── utils.js
├── images/
│   └── assets/
└── docs/
    └── api.md
```

**Result**: Fully functional website with preserved structure

### Media Collections

**Photography Portfolio**:

```
portfolio/
├── 2024/
│   ├── landscapes/
│   ├── portraits/
│   └── street/
├── equipment/
│   └── gear-list.txt
└── contact.txt
```

**Result**: Browsable gallery with auto-generated navigation

### Software Distribution

**Application Release**:

```
software-v2.0/
├── binaries/
│   ├── windows/
│   ├── mac/
│   └── linux/
├── documentation/
│   ├── user-manual.pdf
│   └── api-docs/
├── examples/
└── LICENSE
```

**Result**: Professional download portal with organized access

## Advanced Features

### Nested Archive Handling

- **ZIP within ZIP**: Outer archive extracted, inner preserved as downloadable file
- **Mixed Formats**: TAR, GZ, and other archives preserved within main extraction
- **Selective Processing**: Only the main uploaded archive gets full processing

### Error Recovery and Validation

- **File Corruption**: Skips corrupted files, continues with valid ones
- **Permission Issues**: Clear error messages for access problems
- **Network Failures**: Automatic retry with exponential backoff
- **Partial Success**: Continues even if some files fail to process

### Cross-Platform Compatibility

- **File System Differences**: Handles Windows/Mac/Linux path conventions
- **Character Encoding**: Proper UTF-8 handling for international filenames
- **Case Sensitivity**: Intelligent handling of case conflicts
- **Special Characters**: Safe processing of non-ASCII characters

## Migration Benefits

### From Traditional File Sharing

**Before**: Email attachments, cloud storage links, FTP servers
**After**: Permanent, decentralized, browsable archives

Benefits:

- No expiration dates or account dependencies
- Professional presentation with branding
- Better organization with auto-generated navigation
- Immutable content with cryptographic verification

### From Static Website Hosting

**Before**: Traditional web hosting services
**After**: Decentralized website hosting on Swarm

Benefits:

- No server maintenance or hosting fees
- Censorship-resistant and permanent storage
- Automatic SSL/TLS through Swarm gateways
- Global content distribution

### From Archive Sharing

**Before**: Raw ZIP/TAR files shared via various services  
**After**: Professional, browsable websites with file navigation

Benefits:

- No special software needed to access files
- Professional appearance increases trust
- Better user experience with web-based navigation
- Mobile-friendly responsive design

## Best Practices

### Content Organization

1. **Logical Structure**: Organize files in meaningful folders
2. **Clear Naming**: Use descriptive, consistent file names
3. **Documentation**: Include README files for context
4. **Size Management**: Keep archives reasonably sized for faster processing
5. **Testing**: Verify folder/archive structure before uploading

### Performance Optimization

1. **Stable Connection**: Ensure reliable internet for uploads
2. **Browser Resources**: Close unnecessary tabs for large uploads
3. **File Cleanup**: Remove unnecessary files before archiving
4. **Batch Sizing**: Consider splitting very large collections
5. **Progress Monitoring**: Keep browser tab active during processing

### Security and Privacy

1. **Content Review**: Verify no sensitive files are included
2. **Access Control**: Remember that uploads are publicly accessible
3. **Backup Strategy**: Export upload history for record keeping
4. **Wallet Security**: Protect wallet access for stamp management
5. **Link Sharing**: Share Swarm URLs responsibly

---

_This comprehensive guide covers all aspects of archive processing in Beesnap. For specific upload types, see: [Folder Upload](./folder-upload.md), [ZIP File Upload](./zip-file-upload.md), and [Webpage Upload](./webpage-upload.md)._
