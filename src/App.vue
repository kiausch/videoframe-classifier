<script>
import { os, storage, filesystem, server } from '@neutralinojs/lib'
    
export default {
    data() {
        return {
            // Left Column - Video Selection
            selectedVideoFolder: null,
            videoFiles: [],
            selectedVideoFiles: [],
            processedVideoFiles: new Set(),
            currentVideo: null,
            currentVideoUrl: null,
            projectFolder: null,
            isPreprocessing: false,
            hideProcessedVideos: true,
            imageExtractionFramerate: 1,

            // Center Column - Image Gallery
            imageFiles: [],
            selectedImages: [],
            previewSize: 128,
            lastSelectedIndex: null,

            // Right Column - Label Assignment
            datasetLabels: [],
            isLabelEditorOpen: false,
            lastMoved: [], // for undo functionality
            labelStatistics: {},
            trainingSplit: 0.8,

            // UI State
            snackbar: {
                visible: false,
                message: '',
                color: 'info',
                timeout: 3000
            },
            overwriteConfirmDialog: false,

            // Statistics
            stats: {
                videoCount: 0,
                imageCount: 0,
                selectedImages: 0
            },

            // Constants
            VIDEO_EXTENSIONS: ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm'],
            IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
        };
    },
    computed: {
        stats() {
            return {
                videoCount: this.videoFiles.length,
                imageCount: this.imageFiles.length,
                selectedImages: this.selectedImages.length
            };
        },
        imageQueueFolder() {
            return this.projectFolder ? this.projectFolder + '/pool' : null;
        },
        canPreprocess() {
            return this.selectedVideoFolder && this.projectFolder && this.videoFiles.length > 0;
        },
        filteredVideoFiles() {
            if (this.hideProcessedVideos) {
                return this.videoFiles.filter(video => {
                    const fullPath = this.selectedVideoFolder + '/' + video;
                    return !this.processedVideoFiles.has(fullPath);
                });
            }
            return this.videoFiles;
        }
    },
    watch: {
        isLabelEditorOpen(newVal, oldVal) {
            // When closing the label editor, write changes to project.json
            if (newVal == false && oldVal == true) {
                this.saveProjectFile();
            }
        }
    },
    mounted() {
        this.setupKeyboardShortcuts();
        this.loadSettings();
    },
    methods: {
        async loadSettings() {
            try {
                this.projectFolder = await storage.getData('projectFolder');
                await this.loadProjectFile();
                await this.loadImageFiles();
                await this.updateLabelStatistics();
                if (this.selectedVideoFolder) {
                    await this.loadVideoFiles();
                }
            }
            catch (error) {
                this.projectFolder = null;
            }
        },

        async mountFolder(folderPath, mountPoint) {
            try {
                // Unmount if already mounted
                try {
                    await server.unmount('/' + mountPoint);
                } catch (e) {
                    // Ignore if not mounted
                }

                // Mount the local folder to a server resource path
                await server.mount('/' + mountPoint, folderPath);
                return true;
            } catch (error) {
                console.error('Error mounting folder:', error);
                return false;
            }
        },

        getServerUrl(mountPoint, fileName) {
            // Construct URL using the mounted path
            return '/' + mountPoint + '/' + fileName;
        },

        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                
                // 0-9 for label assignment (skip if input is focused)
                if (e.key >= '0' && e.key <= '9') {
                    // Check if focus is on an input field
                    const focusedElement = document.activeElement;
                    const isInputFocused = focusedElement && (
                        focusedElement.tagName === 'INPUT' || 
                        focusedElement.tagName === 'TEXTAREA'
                    );
                    if(!isInputFocused) {
                        e.preventDefault();
                        const index = parseInt(e.key);
                        if (index < this.datasetLabels.length && this.selectedImages.length > 0) {
                            this.assignLabel(index);
                        }   
                    }
                }
                // arrow keys to move selection
                else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (this.imageFiles.length === 0) return;

                    let newIndex = this.lastSelectedIndex || 0;
                    let numColumns = window.getComputedStyle(this.$refs.imageGallery)?.getPropertyValue('grid-template-columns')?.split(' ')?.length || 1;

                    if (e.key === 'ArrowRight') {
                        newIndex++;
                    } else if (e.key === 'ArrowLeft') {
                        newIndex--;
                    } else if (e.key === 'ArrowUp') {
                        newIndex -= numColumns;
                    } else if (e.key === 'ArrowDown') {
                        newIndex += numColumns;
                    }

                    if (newIndex < 0) newIndex = 0;
                    if (newIndex >= this.imageFiles.length) newIndex = this.imageFiles.length - 1;

                    const image = this.imageFiles[newIndex];
                    this.handleImageSelect(image, e);

                    // scroll into view
                    this.$nextTick(() => {
                        const imgElement = this.$refs.imageGallery.querySelectorAll('.gallery-item')[newIndex];
                        if (imgElement) {
                            imgElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    });
                }
                else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    this.undoLastMove();
                }
                // Ctrl/Meta + '+' to increase image size
                else if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    this.previewSize = Math.min(this.previewSize + 16, 512);
                }
                // Ctrl/Meta + '-' to decrease image size
                else if (e.key === '-' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    this.previewSize = Math.max(this.previewSize - 16, 128);
                }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.currentVideo = null;
                    this.currentVideoUrl = null;
                    this.initImageSelection();
                }
            });
        },

        /* ===== File/Folder Selection ===== */
        async selectVideoFolder() {
            try {
                const folder = await os.showFolderDialog('Select Video Folder');
                if (folder) {
                    this.selectedVideoFolder = folder;
                    await this.loadVideoFiles();
                    await this.saveProjectFile();
                    this.showMessage('Video folder loaded', 'success');
                }
            } catch (error) {
                this.showMessage('Error selecting folder: ' + error.message, 'error');
            }
        },

        async selectProjectFolder() {
            try {
                const folder = await os.showFolderDialog('Select Project Folder');
                if (folder) {
                    this.projectFolder = folder;
                    await this.loadProjectFile();
                    await this.loadImageFiles();
                    await this.updateLabelStatistics();
                    await storage.setData('projectFolder', folder);
                }
            } catch (error) {
                this.showMessage('Error selecting folder: ' + error.message, 'error');
            }
        },

        async updateLabelStatistics() {
            this.labelStatistics = {};
            if (!this.projectFolder) return;
            for (const label of this.datasetLabels) {
                this.labelStatistics[label] = 0;
                const labelFolder = this.projectFolder + '/classes/' + label;
                try {
                    const stats = await filesystem.getStats(labelFolder);
                    if (stats.isDirectory) {
                        const files = await filesystem.readDirectory(labelFolder);
                        this.labelStatistics[label] = files.filter(file => file.type === 'FILE').length;
                    }
                } catch (error) {
                    // Folder might not exist yet
                }
            }
        },

        /* ===== File Operations ===== */
        async loadVideoFiles() {
            try {
                if (!this.selectedVideoFolder) return;

                await this.mountFolder(this.selectedVideoFolder, 'videos');

                const files = await filesystem.readDirectory(this.selectedVideoFolder);
                this.videoFiles = files
                    .filter(file => {
                        if(file.type !== 'FILE') return false;
                        const fileName = file.entry;
                        const ext = '.' + fileName.split('.').pop().toLowerCase();
                        return this.VIDEO_EXTENSIONS.includes(ext) && !fileName.startsWith('.');
                    })
                    .map(file => file.entry)
                    .sort();

                this.currentVideo = null;
                this.currentVideoUrl = null;
            } catch (error) {
                this.showMessage('Error loading videos: ' + error.message, 'error');
            }
        },

        async loadImageFiles() {
            try {
                
                try {
                    if (!this.imageQueueFolder) {
                        throw new Error();
                    }
                    await filesystem.getStats(this.imageQueueFolder);
                } catch (error) {
                    this.imageFiles = [];
                    return;
                }
                
                await this.mountFolder(this.imageQueueFolder, 'images');
                const files = await filesystem.readDirectory(this.imageQueueFolder);
                this.imageFiles = files
                    .filter(file => {
                        if(file.type !== 'FILE') return false;
                        const fileName = file.entry;
                        const ext = '.' + fileName.split('.').pop().toLowerCase();
                        return this.IMAGE_EXTENSIONS.includes(ext) && !fileName.startsWith('.');
                    })
                    .map(file => file.entry)
                    .sort();

                this.initImageSelection();

            } catch (error) {
                this.showMessage('Error loading images: ' + error.message, 'error');
            }
        },

        initImageSelection() {
            if (this.imageFiles.length > 0) {
                this.selectedImages = [this.imageFiles[0]];
                this.lastSelectedIndex = 0;
            } else {
                this.selectedImages = [];
                this.lastSelectedIndex = null;
            }
        },

        async loadProjectFile() {
            if (!this.projectFolder) return;

            const projectPath = this.projectFolder + '/project.json';
            try {
                const content = await filesystem.readFile(projectPath);
                const project = JSON.parse(content);
                this.datasetLabels = project.labels || [];
                this.selectedVideoFolder = project.selectedVideoFolder || null;
                
                if (project.processedVideos) {
                    for (const video of project.processedVideos) {
                        this.processedVideoFiles.add(video);
                    }
                }
                this.showMessage('Project loaded', 'success');
            } catch (error) {
                this.showMessage('No project.json found or error reading file. Starting new project', 'success');
                this.datasetLabels = [];
                this.selectedVideoFolder = null;
                this.processedVideoFiles.clear();
            }
        },

        async saveProjectFile() {
            try {
                if (!this.projectFolder) return;
                const projectPath = this.projectFolder + '/project.json';
                const project = {
                    labels: this.datasetLabels,
                    selectedVideoFolder: this.selectedVideoFolder,
                    processedVideos: [...this.processedVideoFiles]
                };
                const content = JSON.stringify(project, null, 2);
                await filesystem.writeFile(projectPath, content);
            } catch (error) {
                this.showMessage('Error saving project: ' + error.message, 'error');
            }
        },

        addNewLabel() {
            this.datasetLabels.push('new_label');
        },

        removeLabel(index) {
            this.datasetLabels.splice(index, 1);
        },

        /* ===== Video Selection ===== */
        selectVideo(videoName) {
            this.currentVideo = videoName;
            this.currentVideoUrl = this.getServerUrl('videos', videoName);
        },
        toggleSelectedVideo(videoName) {
            const index = this.selectedVideoFiles.indexOf(videoName);
            if (index > -1) {
                this.selectedVideoFiles.splice(index, 1);
            } else {
                this.selectedVideoFiles.push(videoName);
            }
        },

        /* ===== Image Gallery ===== */
        getImageUrl(imageName) {
            if (!this.imageQueueFolder) return '';
            return this.getServerUrl('images', imageName);
        },

        handleImageSelect(image, event) {
            const index = this.imageFiles.indexOf(image);

            if (event.ctrlKey || event.metaKey || event.shiftKey) {
                if (event.shiftKey && this.lastSelectedIndex !== null) {
                    const increment = index > this.lastSelectedIndex ? -1 : 1;
                    if (this.selectedImages.includes(image)) {
                        // Deselect range from lastSelectedIndex to index (not including index)
                        for (let i = this.lastSelectedIndex; i != index; i -= increment) {
                            const pos = this.selectedImages.indexOf(this.imageFiles[i]);
                            if (pos > -1) {
                                this.selectedImages.splice(pos, 1);
                            }
                        }
                    } else {
                        // Select range from lastSelectedIndex to index (including index)
                        for (let i = index; i != this.lastSelectedIndex; i += increment) {
                            if (!this.selectedImages.includes(this.imageFiles[i])) {
                                this.selectedImages.push(this.imageFiles[i]);
                            }
                        }
                    }
                } else {
                    // Toggle select with Ctrl or meta
                    const pos = this.selectedImages.indexOf(image);
                    if (pos > -1) {
                        this.selectedImages.splice(pos, 1);
                    } else {
                        this.selectedImages.push(image);
                    }
                }
            } else {
                // Single select
                this.selectedImages = [image];
            }

            this.lastSelectedIndex = index;
        },

        /* ===== Video Preprocessing ===== */
        async extractFramesFromVideos() {
            try {
                if (!this.selectedVideoFolder || !this.imageQueueFolder) {
                    this.showMessage('Select both video and process folders', 'warning');
                    return;
                }

                filesystem.createDirectory(this.imageQueueFolder).catch(() => {});

                this.isPreprocessing = true;
                let processedCount = 0;

                for (const video of this.selectedVideoFiles) {
                    try {
                        const videoPath = this.selectedVideoFolder + '/' + video;
                        const imageBaseName = video.split('.')[0];
                        const outputPattern = this.imageQueueFolder + '/' + imageBaseName + '_%05d.jpg';

                        // Build FFmpeg command
                        const command = `ffmpeg -i "${videoPath}" -vf fps=${this.imageExtractionFramerate} "${outputPattern}"`;

                        // Execute preprocessing
                        const result = await os.execCommand(command);
                        processedCount++;
                    } catch (error) {
                        this.showMessage(`Error processing ${video}: ` + error.message, 'warning');
                    }
                }

                // Reload images after preprocessing
                await this.loadImageFiles();
                this.isPreprocessing = false;
                this.showMessage(`Processed ${processedCount} video(s)`, 'success');
                let processedVideo;
                while(processedVideo = this.selectedVideoFiles.pop()) {
                    const fullPath = this.selectedVideoFolder + '/' + processedVideo;
                    this.processedVideoFiles.add(fullPath);
                }
                await this.saveProjectFile();
            } catch (error) {
                this.isPreprocessing = false;
                this.showMessage('Error extracting frames: ' + error.message, 'error');
            }
        },

        /* ===== Label Assignment ===== */
        async assignLabel(labelIndex) {
            try {
                if (!this.projectFolder || this.selectedImages.length === 0) {
                    this.showMessage('Select project folder and images', 'warning');
                    return;
                }

                if (labelIndex < 0 || labelIndex >= this.datasetLabels.length) {
                    this.showMessage('Invalid label index', 'warning');
                    return;
                }

                const label = this.datasetLabels[labelIndex];

                const labelFolder = this.projectFolder + '/classes/' + label;

                // Create label folder if it doesn't exist
                try {
                    await filesystem.createDirectory(labelFolder);
                } catch (error) {
                    // Folder might already exist
                }

                let movedCount = 0;
                this.lastMoved = [];
                let removeIndex;
                for (const image of this.selectedImages) {
                    try {
                        const sourcePath = this.imageQueueFolder + '/' + image;
                        const destPath = labelFolder + '/' + image;
                        await filesystem.move(sourcePath, destPath);
                        this.lastMoved.push({from: sourcePath, to: destPath});
                        movedCount++;
                        removeIndex = this.imageFiles.indexOf(image);
                        this.imageFiles.splice(removeIndex, 1);
                    } catch (error) {
                        this.showMessage(`Error moving ${image}: ` + error.message, 'warning');
                    }
                }

                // next selected image is the one after the last moved
                let nextIndex = removeIndex;
                if (nextIndex >= this.imageFiles.length) {
                    nextIndex = this.imageFiles.length - 1;
                }
                if (nextIndex >= 0) {
                    this.selectedImages = [this.imageFiles[nextIndex]];
                    this.lastSelectedIndex = nextIndex;
                } else {
                    this.selectedImages = [];
                    this.lastSelectedIndex = null;
                }

                this.labelStatistics[label] += movedCount;
                this.showMessage(`Moved ${movedCount} image(s) to ${label}`, 'success');
            } catch (error) {
                this.showMessage('Error assigning label: ' + error.message, 'error');
            }
        },

        async undoLastMove() {
            try {
                if (this.lastMoved.length === 0) {
                    this.showMessage('No moves to undo', 'info');
                    return;
                }
                while (this.lastMoved.length > 0) {
                    const moved = this.lastMoved.pop();
                    await filesystem.move(moved.to, moved.from);
                }
                await this.loadImageFiles();
                await this.updateLabelStatistics();
            } catch (error) {
                this.showMessage('Error undoing move: ' + error.message, 'error');
            }
        },

        async createTrainingDataset() {
            try {
                if (!this.projectFolder) {
                    this.showMessage('Select project folder first', 'warning');
                    return;
                }

                // Check if train or val folders already exist
                const datasetFolder = this.projectFolder + '/dataset';
                const trainFolder = datasetFolder + '/train';
                const valFolder = datasetFolder + '/val';
                
                let trainExists = false;
                let valExists = false;
                
                try {
                    const trainStats = await filesystem.getStats(trainFolder);
                    trainExists = trainStats.isDirectory;
                } catch (e) {
                    trainExists = false;
                }
                
                try {
                    const valStats = await filesystem.getStats(valFolder);
                    valExists = valStats.isDirectory;
                } catch (e) {
                    valExists = false;
                }

                // Show confirmation if either folder exists
                if (trainExists || valExists) {
                    this.overwriteConfirmDialog = true;
                    return;
                }

                await this.performTrainingDatasetCreation();
            } catch (error) {
                this.showMessage('Error: ' + error.message, 'error');
            }
        },

        async performTrainingDatasetCreation() {
            function shuffle(array) {
                for(let index = array.length - 1; index > 0; index--) {
                    let randomIndex = Math.floor(Math.random() * (index + 1));
                    [array[index], array[randomIndex]] = [array[randomIndex], array[index]];
                }
                return array;   // note: the array is shuffled in place, return for ease of use
            }

            try {
                // Delete existing train and val folders if they exist
                const datasetFolder = this.projectFolder + '/dataset';
                const trainFolder = datasetFolder + '/train';
                const valFolder = datasetFolder + '/val';

                try {
                    await filesystem.removeDirectory(trainFolder);
                } catch (e) {
                    // Folder doesn't exist, ignore
                }

                try {
                    await filesystem.removeDirectory(valFolder);
                } catch (e) {
                    // Folder doesn't exist, ignore
                }

                for (const label of this.datasetLabels) {
                    const labelFolder = this.projectFolder + '/classes/' + label;
                    await filesystem.createDirectory(datasetFolder).catch(() => {});
                    const trainFolder = datasetFolder + '/train/' + label;
                    const valFolder = datasetFolder + '/val/' + label;
                    try {
                        const stats = await filesystem.getStats(labelFolder);
                        if (stats.isDirectory) {
                            const files = await filesystem.readDirectory(labelFolder);
                            const imageFiles = shuffle(files.filter(file => file.type === 'FILE').map(file => file.entry));
                            const trainCount = Math.floor(imageFiles.length * this.trainingSplit);
                            await filesystem.createDirectory(trainFolder).catch(() => {});
                            await filesystem.createDirectory(valFolder).catch(() => {});
                            for (let i = 0; i < imageFiles.length; i++) {
                                const sourcePath = labelFolder + '/' + imageFiles[i];
                                const destPath = (i < trainCount ? trainFolder : valFolder) + '/' + imageFiles[i];
                                await filesystem.copy(sourcePath, destPath);
                            }
                        }
                    } catch (error) {
                        // Folder might not exist yet
                        this.showMessage('Error creating training dataset: ' + error.message, 'error');
                    }
                }
                
                // Create dataset.yaml
                try {
                    const datasetPath = this.projectFolder + '/dataset/dataset.yaml';
                    let yamlContent = 'names:\n';
                    for (const [index, label] of this.datasetLabels.entries()) {
                        yamlContent += `  ${index}: ${label}\n`;
                    }
                    yamlContent += `\nsplits:\n  train: ${this.trainingSplit}\n  val: ${1 - this.trainingSplit}\n`;
                    await filesystem.writeFile(datasetPath, yamlContent);
                    this.showMessage('Training dataset created successfully', 'success');
                } catch (error) {
                    this.showMessage('Error creating dataset.yaml: ' + error.message, 'error');
                }
            } catch (error) {
                this.showMessage('Error creating training dataset: ' + error.message, 'error');
            }
        },

        /* ===== Helper Methods ===== */
        getKeyboardShortcut(index) {
            return `${index}`;
        },

        showMessage(message, color = 'info') {
            this.snackbar.message = message;
            this.snackbar.color = color;
            this.snackbar.visible = true;
        }
    }
};

</script>

<template>
    <v-app>
        <v-dialog v-model="isLabelEditorOpen" max-width="500px">
            <v-card>
                <v-card-title>Edit Dataset Labels</v-card-title>
                <v-card-text>
                    <v-text-field v-for="(label, index) in datasetLabels" :key="index"
                        v-model="datasetLabels[index]" class="mb-2" density="compact" variant="solo">
                        <template v-slot:append>
                            <v-btn icon="mdi-delete" color="red" @click="removeLabel(index)"
                                :disabled="datasetLabels.length <= 1" title="Remove Label"></v-btn>
                        </template>
                    </v-text-field>
                    <v-btn color="primary" @click="addNewLabel">Add Label</v-btn>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn text @click="isLabelEditorOpen = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="overwriteConfirmDialog" max-width="400px">
            <v-card>
                <v-card-title>Overwrite Training Data?</v-card-title>
                <v-card-text>
                    <p>Training or validation folders already exist. Creating a new training dataset will overwrite the existing data.</p>
                    <p><strong>Do you want to continue?</strong></p>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn text @click="overwriteConfirmDialog = false">Cancel</v-btn>
                    <v-btn color="warning" @click="overwriteConfirmDialog = false; performTrainingDatasetCreation()">Overwrite</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-app-bar color="primary" density="comfortable">
            <v-app-bar-title>Video Frame Classification Tool</v-app-bar-title>
            <template v-slot:append>
                <span v-if="stats">
                    Videos: {{ stats.videoCount }} | Images: {{ stats.imageCount }} | Selected: {{ stats.selectedImages }}
                </span>
            </template>
        </v-app-bar>

        <!-- Left Column: Video Selection -->
        <v-navigation-drawer width="350" permanent>
            <v-container class="d-flex flex-column h-100 pa-2">
                <v-card class="flex-0-0 mb-2">
                    <v-card-text>
                        <!-- Project Folder Selection -->
                        <v-text-field
                            label="Choose Project Folder"
                            :model-value="projectFolder"
                            :title="projectFolder"
                            append-inner-icon="mdi-folder-open"
                            @click:append-inner="selectProjectFolder"
                            variant="outlined"
                            readonly
                        ></v-text-field>

                        <!-- Video Folder Selection -->
                        <v-text-field
                            label="Choose Video Folder"
                            :model-value="selectedVideoFolder"
                            :title="selectedVideoFolder"
                            append-inner-icon="mdi-folder-open"
                            @click:append-inner="selectVideoFolder"
                            :disabled="!projectFolder"
                            variant="outlined"
                            readonly
                        ></v-text-field>

                    </v-card-text>
                </v-card>

                <!-- Video List -->
                <v-card class="flex-1-1 overflow-auto mb-2">
                    <v-toolbar density="compact">
                        <v-toolbar-title>Select Videos</v-toolbar-title>
                        <v-btn icon="mdi-filter-check-outline" title="show processed"
                            @click="hideProcessedVideos = !hideProcessedVideos"
                            :class="{ 'opacity-30': hideProcessedVideos }"></v-btn>
                    </v-toolbar>
                    <v-list density="compact">
                        <v-list-item v-for="video in filteredVideoFiles" 
                            :key="video" 
                            :value="video"
                            :title="video" 
                            @click="selectVideo(video)" 
                            :class="{ 'v-item--active': currentVideo === video,
                                            'processed': processedVideoFiles.has(selectedVideoFolder + '/' + video) }"
                            class="video-list-item">
                            <template v-slot:prepend="{ isSelected, select }">
                                <v-list-item-action start>
                                    <v-checkbox-btn 
                                        density="compact"
                                        :model-value="selectedVideoFiles.includes(video)"
                                        @update:model-value="toggleSelectedVideo(video)"
                                        @click.stop></v-checkbox-btn>
                                </v-list-item-action>
                            </template>
                        </v-list-item>
                    </v-list>
                </v-card>

                <!-- frame processing controls -->
                <v-card class="flex-0-0">
                    <v-card-text>
                        <v-number-input
                            label="frame rate"
                            control-variant="stacked"
                            variant="outlined"
                            v-model="imageExtractionFramerate"
                            :min="0"
                            :max="100"
                            :precision="1"
                            ></v-number-input>
                        <v-btn color="success"
                            block
                            :disabled="!selectedVideoFolder || !projectFolder || videoFiles.length === 0"
                            :loading="isPreprocessing"
                            @click="extractFramesFromVideos"
                            prepend-icon="mdi-play"
                            title="Extract images from selected videos at the configured frame rate">
                            Extract Images
                        </v-btn>
                    </v-card-text>
                </v-card>
            </v-container>
        </v-navigation-drawer>

        <v-main>
            <!-- Center Column: Video proview / Image Gallery -->
            <v-container class="d-flex flex-column pa-2">
                <!-- Video Player -->
                <v-card v-if="currentVideo" class="d-flex flex-column">
                    <v-toolbar density="compact">
                        <v-toolbar-title>Video Preview</v-toolbar-title>
                        <v-btn icon="mdi-close" @click="currentVideo = null" title="Close Preview"></v-btn>
                    </v-toolbar>
                    <v-card-text class="d-flex justify-center ma-4">
                        <video :src="currentVideoUrl" width="80%" controls
                            style="background: #000; border-radius: 4px;">
                        </video>
                    </v-card-text>
                </v-card>

                <!-- Image Gallery -->
                <v-card v-else>
                    <v-toolbar density="compact">
                        <v-toolbar-title>Images to Classify</v-toolbar-title>
                        <v-slider v-model="previewSize" label="Image Size" min="128" max="512" step="16"
                            style="max-width: 250px" class="align-center" hide-details>
                            <template v-slot:append>
                                <span v-text="previewSize + 'px'"></span>
                            </template>
                        </v-slider>
                        <v-btn icon="mdi-reload" @click="loadImageFiles" title="Reload Images"></v-btn>
                    </v-toolbar>
                    <v-card-text>
                        <div v-if="imageFiles.length === 0" class="flex-center">
                            <p class="text-caption text-disabled">No images to process</p>
                        </div>
                        <div v-else style="flex: 1; overflow-y: auto;">
                            <div ref="imageGallery" class="image-gallery"
                                :style="{ '--preview-size': previewSize + 'px' }">
                                <div v-for="image in imageFiles" :key="image" class="gallery-item"
                                    :class="{ 'selected': selectedImages.includes(image) }"
                                    @click="handleImageSelect(image, $event)"
                                    @contextmenu.prevent="handleImageSelect(image, { ctrlKey: true, shiftKey: false })"
                                    draggable="true">
                                    <img :src="getImageUrl(image)" :alt="image" :width="previewSize"
                                        :height="previewSize">
                                    <div class="image-name">{{ image }}</div>
                                </div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-container>
        </v-main>

        <!-- Right Column: Label Assignment -->
        <v-navigation-drawer location="right" width="300" permanent>
            <v-container class="d-flex flex-column h-100 pa-2">
                <v-card>
                    <v-toolbar density="compact">
                        <v-toolbar-title>Assign Label</v-toolbar-title>
                        <v-btn icon="mdi-playlist-edit" @click="isLabelEditorOpen = true"
                            title="Edit Labels" :disabled="!projectFolder"></v-btn>
                    </v-toolbar>
                    <v-card-text v-if="!projectFolder" class="flex-center mt-4">
                        <p class="text-caption text-disabled">Select project folder</p>
                    </v-card-text>
                    <v-card-text v-else-if="datasetLabels.length == 0" class="flex-center mt-4">
                        <p class="text-caption text-disabled">Create labels using the "Edit Labels" button</p>
                    </v-card-text>
                    <v-card-text v-else>
                        <!-- Label Buttons -->
                        <v-btn v-for="(label, index) in datasetLabels" :key="index" 
                            block
                            color="info"
                            :disabled="selectedImages.length === 0" 
                            @click="assignLabel(index)"
                            :text="label"
                            class="mb-2"
                        >
                            <template v-slot:append>
                                <v-hotkey variant="plain" :keys="getKeyboardShortcut(index)"></v-hotkey>
                            </template>
                        </v-btn>
                    </v-card-text>

                </v-card>

                <v-card class="mt-2">
                    <v-toolbar density="compact">
                        <v-toolbar-title>Statistics</v-toolbar-title>
                        <v-btn icon="mdi-refresh" @click="updateLabelStatistics" title="Refresh Statistics"></v-btn>
                    </v-toolbar>
                    <v-card-text>
                        <v-list density="compact">
                            <v-list-item v-for="(label, index) in datasetLabels" :key="index">
                                <v-list-item-title>
                                    {{ datasetLabels[index] }}: {{ labelStatistics[label] || 0 }}
                                </v-list-item-title>
                            </v-list-item>
                        </v-list>
                    </v-card-text>
                </v-card>

                <v-card class="mt-2">
                    <v-toolbar density="compact">
                        <v-toolbar-title>Training Dataset</v-toolbar-title>
                    </v-toolbar>
                    <v-card-text>
                        <div class="text-caption">Train / Validate Split</div>
                        <v-slider v-model="trainingSplit"
                            min="0.5"
                            max="0.95"
                            step="0.01"
                            class="mb-4"
                            hide-details>
                            <template v-slot:append>
                                <span v-text="Math.floor(trainingSplit * 100) + '%'"></span>
                            </template>
                        </v-slider>
                        <v-btn color="success"
                            block
                            @click="createTrainingDataset"
                            prepend-icon="mdi-folder-plus"
                            title="Create Training Dataset"
                            :disabled="!projectFolder || datasetLabels.length == 0">
                            Create Training Dataset
                        </v-btn>
                    </v-card-text>
                </v-card>
            </v-container>
        </v-navigation-drawer>

        <!-- Snackbar for notifications -->
        <v-snackbar v-model="snackbar.visible" :timeout="snackbar.timeout" :color="snackbar.color">
            {{ snackbar.message }}
        </v-snackbar>
    </v-app>
</template>