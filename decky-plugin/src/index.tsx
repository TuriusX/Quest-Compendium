import {
  definePlugin,
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ServerAPI,
} from "decky-frontend-lib";
import { VFC, useState } from "react";
import { FaBook } from "react-icons/fa";

const Content: VFC<{ serverAPI: ServerAPI }> = ({ serverAPI }) => {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const takeScreenshot = async () => {
    setLoading(true);
    try {
      const response = await serverAPI.callPluginMethod<{ success: boolean; image?: string; error?: string }, "get_screenshot">("get_screenshot", {});
      
      if (response.success && response.result.success && response.result.image) {
        setScreenshot(`data:image/png;base64,${response.result.image}`);
      } else {
        console.error("Screenshot failed:", response.result.error);
      }
    } catch (e) {
      console.error("Error calling backend:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PanelSection title="Quest Compendium AI">
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={takeScreenshot}
          disabled={loading}
        >
          {loading ? "Capturing..." : "Analyze Screen"}
        </ButtonItem>
      </PanelSectionRow>
      
      {screenshot && (
        <PanelSectionRow>
          <div style={{ marginTop: "10px", textAlign: "center" }}>
            <img 
              src={screenshot} 
              alt="Game Capture" 
              style={{ width: "100%", borderRadius: "4px" }} 
            />
          </div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  return {
    title: <div className="title">Quest Compendium</div>,
    content: <Content serverAPI={serverApi} />,
    icon: <FaBook />,
    onDismount() {},
  };
});
