import os
import subprocess
import base64
import decky_plugin

class Plugin:
    async def get_screenshot(self):
        """
        Takes a screenshot using SteamOS built-in tools and returns it as a base64 string.
        """
        decky_plugin.logger.info("Attempting to capture screenshot...")
        temp_path = "/tmp/qc_screenshot.png"
        
        try:
            # Method 1: ffmpeg kmsgrab (Works well in Gaming Mode as root)
            subprocess.run(
                ["ffmpeg", "-y", "-f", "kmsgrab", "-i", "-", "-vf", "hwdownload,format=bgr0", "-frames:v", "1", temp_path], 
                check=False, 
                stderr=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL
            )
            
            # Method 2: scrot fallback (If in desktop mode or X11)
            if not os.path.exists(temp_path) or os.path.getsize(temp_path) == 0:
                decky_plugin.logger.info("ffmpeg failed or returned empty, falling back to scrot...")
                subprocess.run(
                    ["scrot", "-z", temp_path], 
                    check=False, 
                    stderr=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL
                )
            
            # Check if we successfully got an image
            if not os.path.exists(temp_path):
                return {"success": False, "error": "Both screenshot methods failed."}
            
            # Read and encode to base64
            with open(temp_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode("utf-8")
            
            # Clean up the temp file
            try:
                os.remove(temp_path)
            except OSError:
                pass
                
            return {"success": True, "image": encoded_string}
            
        except Exception as e:
            decky_plugin.logger.error(f"Screenshot error: {e}")
            return {"success": False, "error": str(e)}
