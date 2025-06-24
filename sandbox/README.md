# 🎨 ComfyUI Installation Sandbox

[![ComfyUI](https://img.shields.io/badge/ComfyUI-Latest-orange.svg)](https://github.com/comfyanonymous/ComfyUI)
[![CUDA](https://img.shields.io/badge/CUDA-11.8%20to%2012.6-green.svg)](https://developer.nvidia.com/cuda-downloads)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Triton](https://img.shields.io/badge/Triton-Optimized-red.svg)](https://github.com/openai/triton)

**Complete ComfyUI installation environment with automated setup, CUDA optimization, and performance enhancements.**

## 🚀 Quick Start

### **🎯 One-Click Installation**
```bash
# Run the comprehensive installer
Install_ComfyUI_Complete.bat
```

**The installer will guide you through:**
1. **CUDA Version Selection** (11.8, 12.1, 12.4, 12.6, or CPU-only)
2. **Performance Optimization** (Triton & SageAttention)
3. **Build Tools Validation** (for compilation requirements)
4. **Automatic Environment Setup** (Python venv, dependencies)
5. **Custom Launcher Generation** (optimized startup scripts)

### **⚡ Quick Launch**
```bash
# Start your installed ComfyUI instance
ComfyUI_cuda126/Launch_ComfyUI_CUDA126.bat
```

## 📁 Sandbox Structure

```
sandbox/
├── 📄 README.md                           # This guide
├── 🚀 Install_ComfyUI_Complete.bat        # 🌟 Main installer script
├── 🔧 install_triton_sageattention.bat    # Optimization installer
├── 📁 ComfyUI_Sandbox_CUDA126/            # Example installation
│   ├── 🚀 Launch_ComfyUI_CUDA126.bat      # Launcher script
│   └── 📁 ComfyUI/                        # ComfyUI installation
│       ├── 📄 main.py                     # ComfyUI entry point
│       ├── 📁 venv/                       # Python virtual environment
│       ├── 📁 models/                     # AI models directory
│       ├── 📁 custom_nodes/               # Custom nodes
│       ├── 📁 input/                      # Input images
│       ├── 📁 output/                     # Generated images
│       └── 📁 temp/                       # Temporary files
└── 📁 ComfyUI_{cuda_version}/             # Your new installations
```

## 🛠️ Installation Scripts

### **🌟 Install_ComfyUI_Complete.bat**
**Comprehensive installation script with intelligent configuration**

#### **Features:**
- ✅ **CUDA Version Selection**: Choose optimal CUDA version for your GPU
- ✅ **Performance Optimization**: Optional Triton and SageAttention installation
- ✅ **Build Tools Validation**: Checks for Visual Studio C++ compiler
- ✅ **Environment Management**: Automatic Python venv creation
- ✅ **Dependency Resolution**: Smart PyTorch and requirements installation
- ✅ **Custom Launcher Generation**: Creates optimized startup scripts
- ✅ **ComfyUI Manager**: Automatic installation for easy custom node management

#### **CUDA Options:**
| Version | Compatibility | Performance | Best For |
|---------|---------------|-------------|----------|
| **CUDA 12.6** | RTX 40 series, Latest | ⭐⭐⭐⭐⭐ | Maximum performance |
| **CUDA 12.4** | RTX 30/40 series | ⭐⭐⭐⭐ | Modern GPUs |
| **CUDA 12.1** | Most modern GPUs | ⭐⭐⭐ | Balanced compatibility |
| **CUDA 11.8** | Older GPUs | ⭐⭐ | Wide compatibility |
| **CPU Only** | Any system | ⭐ | Testing, no GPU |

#### **Usage:**
```bash
# Interactive installation
Install_ComfyUI_Complete.bat

# Follow the prompts:
# 1. Select CUDA version (1-5)
# 2. Choose optimization options (Y/N)
# 3. Confirm installation (Y/N)
# 4. Wait for completion
```

### **🔧 install_triton_sageattention.bat**
**Advanced optimization installer for existing ComfyUI installations**

#### **Features:**
- ✅ **Triton Installation**: GPU kernel optimization (20-40% performance boost)
- ✅ **SageAttention**: Memory-efficient attention mechanisms
- ✅ **Version Compatibility**: Automatic Triton version selection based on PyTorch
- ✅ **Cache Management**: Clears problematic cache files
- ✅ **Build Validation**: Ensures compilation requirements are met

#### **Triton Compatibility:**
| PyTorch Version | Triton Version | Python Support |
|-----------------|----------------|----------------|
| 2.6+ | 3.2.0 | 3.10, 3.11, 3.12 |
| 2.4-2.5 | 3.1.0 | 3.10, 3.11, 3.12 |
| 2.3 and below | 3.0.0 | 3.10, 3.11, 3.12 |

## 🎮 Usage Guide

### **🚀 Starting ComfyUI**

#### **Method 1: Use Generated Launcher**
```bash
# Navigate to your installation
cd ComfyUI_cuda126

# Run the launcher
Launch_ComfyUI_CUDA126.bat
```

#### **Method 2: Manual Startup**
```bash
# Navigate to ComfyUI directory
cd ComfyUI_cuda126/ComfyUI

# Activate virtual environment
call venv\Scripts\activate.bat

# Start ComfyUI with optimizations
python main.py --fast --windows-standalone-build --use-sage-attention
```

### **🌐 Accessing ComfyUI**
Once started, ComfyUI will be available at:
- **Web Interface**: http://127.0.0.1:8188
- **API Endpoint**: http://127.0.0.1:8188/api

### **📦 Model Management**

#### **Model Directories:**
```
models/
├── checkpoints/        # Main diffusion models (SDXL, Flux, etc.)
├── loras/             # LoRA fine-tuning models
├── vae/               # VAE models for encoding/decoding
├── controlnet/        # ControlNet models
├── upscale_models/    # Upscaling models (ESRGAN, etc.)
├── clip/              # CLIP text encoders
└── embeddings/        # Textual inversions
```

#### **Recommended Models:**
- **Base Model**: FLUX.1-dev or SDXL 1.0
- **VAE**: sdxl_vae.safetensors
- **Upscaler**: 4x-UltraSharp.pth
- **LoRAs**: Based on your creative needs

### **🔧 Custom Nodes**

#### **Pre-installed Custom Nodes:**
- **ComfyUI-Manager**: Node management interface
- **ComfyUI-KJNodes**: Essential utility nodes
- **ComfyUI-Logic**: Logic and control flow nodes
- **ComfyUI-Image-Analysis-Tools**: Image analysis capabilities
- **ComfyUI-HotReloadHack**: Development workflow improvements

#### **Installing Additional Nodes:**
1. **Via ComfyUI Manager**: Use the web interface
2. **Via Git Clone**: Clone to `custom_nodes/` directory
3. **Via MCP Server**: Use the `install_customnodes` tool

## ⚡ Performance Optimization

### **🔥 Triton Acceleration**
Triton provides significant performance improvements through GPU kernel optimization:

- **Performance Gain**: 20-40% faster inference
- **Memory Efficiency**: Reduced VRAM usage
- **Compatibility**: Works with most modern NVIDIA GPUs
- **Automatic**: Enabled with `--use-triton` flag

### **🧠 SageAttention**
Advanced attention mechanism for memory efficiency:

- **Memory Reduction**: Up to 50% less VRAM usage
- **Quality Preservation**: No loss in output quality
- **Large Model Support**: Enables larger models on smaller GPUs
- **Automatic**: Enabled with `--use-sage-attention` flag

### **🚀 Launch Optimizations**
Generated launchers include optimal flags:

```bash
# Optimized startup command
python main.py --fast --windows-standalone-build --use-sage-attention --use-triton
```

## 🔍 Troubleshooting

### **Common Issues**

#### **Installation Problems**
| Issue | Solution |
|-------|----------|
| Python not found | Install Python 3.10+ and add to PATH |
| Git not found | Install Git for Windows |
| Build tools missing | Install Visual Studio Build Tools |
| CUDA mismatch | Select correct CUDA version for your GPU |

#### **Runtime Problems**
| Issue | Solution |
|-------|----------|
| Out of memory | Reduce batch size or enable optimizations |
| Slow performance | Install Triton and SageAttention |
| Models not loading | Check model file integrity and paths |
| Custom nodes failing | Update nodes via ComfyUI Manager |

#### **Performance Issues**
```bash
# Check GPU utilization
nvidia-smi

# Monitor system resources
# Use Task Manager or Resource Monitor

# Clear cache if needed
# Delete contents of temp/ folder
```

### **🔧 Debug Mode**
Enable verbose logging for troubleshooting:

```bash
# Start with debug output
python main.py --verbose --debug
```

## 📊 System Requirements

### **Minimum Requirements**
- **OS**: Windows 10/11 (64-bit)
- **Python**: 3.10 or higher
- **RAM**: 8GB minimum
- **Storage**: 20GB free space
- **GPU**: NVIDIA GTX 1060 6GB or equivalent

### **Recommended Specifications**
- **OS**: Windows 11 (latest)
- **Python**: 3.11 or 3.12
- **RAM**: 32GB or more
- **Storage**: 100GB+ SSD
- **GPU**: NVIDIA RTX 3060 12GB or better
- **CUDA**: 12.6 (latest)

### **For Triton/SageAttention**
- **Build Tools**: Visual Studio 2019/2022 with C++ workload
- **CUDA Toolkit**: Matching your selected CUDA version
- **Additional RAM**: 4GB+ for compilation

## 🆘 Support

### **Getting Help**
- 📖 **Documentation**: Check ComfyUI official docs
- 🐛 **Issues**: Report problems with detailed logs
- 💬 **Community**: Join ComfyUI Discord/Reddit
- 📧 **MCP Server**: Use the ComfyUI MCP server tools

### **Useful Commands**
```bash
# Check installation
python --version
pip list | findstr torch

# Test ComfyUI
python main.py --help

# Update ComfyUI
git pull origin master
pip install -r requirements.txt
```

---

**🎨 Happy Creating with ComfyUI! 🚀**
