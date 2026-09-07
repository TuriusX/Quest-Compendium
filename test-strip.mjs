const text = `You are currently on your Windows desktop with no game running.
Your screen is split between two main applications:
- **On the left:** A web browser open to Google AI Studio, showing a chat interface where you are discussing Final Fantasy characters (like Locke, Kain, and Cecil) and troubleshooting API usage limits.
- **On the right:** Visual Studio Code (a code editor) open to a project named "Quest-Compendium." You are viewing an image file (app-icon.ico), and the terminal at the bottom shows that you just successfully ran a build command to create a setup executable for your app.`;

const cleanText = text.replace(/\*\*/g, '')
                    .replace(/\*/g, '')
                    .replace(/__/g, '')
                    .replace(/_/g, '')
                    .replace(/#/g, '')
                    .replace(/\[(.*?)\]\((.*?)\)/g, '$1') // remove links
                    .replace(/`/g, '');
                    
const sentences = cleanText.match(/[^.!?\n]+[.!?\n]+(?:\s|$)|[^.!?\n]+$/g) || [cleanText];
console.log(sentences);
